""" Stripe payment processing. """
from __future__ import absolute_import, unicode_literals

import logging

import stripe
from oscar.apps.payment.exceptions import GatewayError, TransactionDeclined
from oscar.core.loading import get_model

from ecommerce.extensions.payment.constants import STRIPE_CARD_TYPE_MAP
from ecommerce.extensions.payment.processors import (
    ApplePayMixin,
    BaseClientSidePaymentProcessor,
    HandledProcessorResponse
)

logger = logging.getLogger(__name__)

BillingAddress = get_model('order', 'BillingAddress')
Country = get_model('address', 'Country')
PaymentEvent = get_model('order', 'PaymentEvent')
PaymentEventType = get_model('order', 'PaymentEventType')
PaymentProcessorResponse = get_model('payment', 'PaymentProcessorResponse')
Source = get_model('payment', 'Source')
SourceType = get_model('payment', 'SourceType')


class Braintree(ApplePayMixin, BaseClientSidePaymentProcessor):
    NAME = 'braintree'
    template_name = 'payment/braintree.html'

    def __init__(self, site):
        """
        Constructs a new instance of the Stripe processor.

        Raises:
            KeyError: If no settings configured for this payment processor.
        """
        super(Braintree, self).__init__(site)
        configuration = self.configuration
        self.merchant_id = configuration['merchant_id']
        self.public_key = configuration['public_key']
        self.private_key = configuration['private_key']

    def get_transaction_parameters(self, basket, request=None, use_client_side_checkout=True, **kwargs):
        raise NotImplementedError(
            'The Braintree payment processor does not support transaction parameters.')

    def _get_basket_amount(self, basket):
        return str((basket.total_incl_tax * 100).to_integral_value())

    def handle_processor_response(self, response, basket=None):
        payment_method_nonce = response
        order_number = basket.order_number
        currency = basket.currency

        result = braintree.Transaction.sale({
            "amount": self._get_basket_amount(basket),
            "payment_method_nonce": payment_method_nonce,
            "options": {
                "submit_for_settlement": True
            }
        })
        if result.is_success:
            # Don't charge the customer yet - instead get the transaction
            # id and use that later to complete the sale.
            transaction_id = result.transaction.id
            self.record_processor_response(
                charge, transaction_id=transaction_id, basket=basket)
            logger.info(
                'Successfully created Stripe charge [%s] for basket [%d].', transaction_id, basket.id)
        else:
            error = result.message
            # Handle the error; details will be in "result.message"
            # and/or in "result.errors.deep_errors"
        total = basket.total_incl_tax
        card_number = None
        card_type = None

        return HandledProcessorResponse(
            transaction_id=transaction_id,
            total=total,
            currency=currency,
            card_number=card_number,
            card_type=card_type
        )

    def issue_credit(self, order_number, basket, reference_number, amount, currency):
        try:
            refund = stripe.Refund.create(charge=reference_number)
        except:
            msg = 'An error occurred while attempting to issue a credit (via Stripe) for order [{}].'.format(
                order_number)
            logger.exception(msg)
            raise GatewayError(msg)

        transaction_id = refund.id

        # NOTE: Refund objects subclass dict so there is no need to do any data transformation
        # before storing the response in the database.
        self.record_processor_response(
            refund, transaction_id=transaction_id, basket=basket)

        return transaction_id

    def get_address_from_token(self, token):
        """ Retrieves the billing address associated with token.

        Returns:
            BillingAddress
        """
        data = stripe.Token.retrieve(token)['card']
        address = BillingAddress(
            first_name=data['name'],    # Stripe only has a single name field
            last_name='',
            line1=data['address_line1'],
            line2=data.get('address_line2') or '',
            line4=data['address_city'],  # Oscar uses line4 for city
            postcode=data.get('address_zip') or '',
            state=data.get('address_state') or '',
            country=Country.objects.get(
                iso_3166_1_a2__iexact=data['address_country'])
        )
        return address
