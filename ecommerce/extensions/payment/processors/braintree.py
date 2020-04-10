""" Stripe payment processing. """
from __future__ import absolute_import, unicode_literals

import logging

import braintree
from oscar.apps.payment.exceptions import GatewayError, TransactionDeclined
from oscar.core.loading import get_model

# from ecommerce.extensions.payment.constants import STRIPE_CARD_TYPE_MAP
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
    NAME = 'Braintree'
    template_name = 'payment/braintree.html'

    def __init__(self, site):
        """
        Constructs a new instance of the Stripe processor.

        Raises:
            KeyError: If no settings configured for this payment processor.
        """
        super(Stripe, self).__init__(site)
        configuration = self.configuration
        # if settings.BRAINTREE_PRODUCTION:
        #     braintree_env = braintree.Environment.Production
        # else:
        #     braintree_env = braintree.Environment.Sandbox
        self.braintree_env = configuration['braintree_env']
        self.merchant_id = configuration['merchant_id']
        self.public_key = configuration['public_key']
        self.private_key = configuration['private_key']

        # Configure Braintree
        braintree.Configuration.configure(
            self.braintree_env,
            merchant_id=self.merchant_id,
            public_key=self.public_key,
            private_key=self.private_key,
        )

    def generate_client_token(self):
        return braintree.ClientToken.generate()

    def get_transaction_parameters(self, basket, request=None, use_client_side_checkout=True, **kwargs):
        raise NotImplementedError('The Stripe payment processor does not support transaction parameters.')

    def _get_basket_amount(self, basket):
        return str((basket.total_incl_tax * 100).to_integral_value())

    def handle_processor_response(self, response, basket=None):
        token = response
        order_number = basket.order_number
        currency = basket.currency
        amount = self._get_basket_amount(basket),

        # NOTE: In the future we may want to get/create a Customer. See https://stripe.com/docs/api#customers.
        result = braintree.Transaction.sale({
            # "customer_id": customer_id,
            "amount": amount,
            "payment_method_nonce": token,
            # "descriptor": {
            #     # Definitely check out https://developers.braintreepayments.com/reference/general/validation-errors/all/python#descriptor
            #     "name": "COMPANY.*test",
            # },
            "billing": address_dict,
            "shipping": address_dict,
            "options": {
                # Use this option to store the customer data, if successful
                #  'store_in_vault_on_success': True,
                # Use this option to directly settle the transaction
                # If you want to settle the transaction later, use ``False`` and later on
                # ``braintree.Transaction.submit_for_settlement("the_transaction_id")``
                'submit_for_settlement': True,
            },
        })
        if result.is_success:
            transaction = result.transaction
            label = None
            card_type = None

            if transaction.payment_instrument_type == 'paypal_account':
                card_type = 'PayPal'
                label = transaction.paypal_details.payer_email

            return HandledProcessorResponse(
                transaction_id=transaction.id,
                total=transaction.amount,
                currency=transaction.currency,
                card_number=label,
                card_type=card_type
            )
        else:
            raise GatewayError(result.message)
        # try:
        #     charge = stripe.Charge.create(
        #         amount=self._get_basket_amount(basket),
        #         currency=currency,
        #         source=token,
        #         description=order_number,
        #         metadata={'order_number': order_number}
        #     )
        #     transaction_id = charge.id

        #     # NOTE: Charge objects subclass the dict class so there is no need to do any data transformation
        #     # before storing the response in the database.
        #     self.record_processor_response(charge, transaction_id=transaction_id, basket=basket)
        #     logger.info('Successfully created Stripe charge [%s] for basket [%d].', transaction_id, basket.id)
        # except stripe.error.CardError as ex:
        #     msg = 'Stripe payment for basket [%d] declined with HTTP status [%d]'
        #     body = ex.json_body

        #     logger.exception(msg + ': %s', basket.id, ex.http_status, body)
        #     self.record_processor_response(body, basket=basket)
        #     raise TransactionDeclined(msg, basket.id, ex.http_status)

        # total = basket.total_incl_tax
        # card_number = charge.source.last4
        # card_type = STRIPE_CARD_TYPE_MAP.get(charge.source.brand)

        # return HandledProcessorResponse(
        #     transaction_id=transaction_id,
        #     total=total,
        #     currency=currency,
        #     card_number=card_number,
        #     card_type=card_type
        # )

    def issue_credit(self, order, reference_number, amount, currency):
        result = braintree.Transaction.refund(reference_number, amount=amount)

        basket = order.basket
        if result.is_success:
            transaction = result.transaction
            self.record_processor_response(transaction.to_dict(), transaction_id=transaction.id, basket=basket)
            return transaction.id
        else:
            self.record_processor_response(result.errors.deep_errors, transaction_id=reference_number, basket=basket)
            raise GatewayError(result.errors.deep_errors)

    def get_address_from_token(self, token):
        """ Retrieves the billing address associated with token.

        Returns:
            BillingAddress
        """
        # data = stripe.Token.retrieve(token)['card']
        address = BillingAddress(
            first_name=data['name'],    # Stripe only has a single name field
            last_name='',
            line1=data['address_line1'],
            line2=data.get('address_line2') or '',
            line4=data['address_city'],  # Oscar uses line4 for city
            postcode=data.get('address_zip') or '',
            state=data.get('address_state') or '',
            country=Country.objects.get(iso_3166_1_a2__iexact=data['address_country'])
        )
        return address
