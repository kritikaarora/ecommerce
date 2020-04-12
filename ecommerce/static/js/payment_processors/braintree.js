/**
 * Braintree payment processor specific actions.
 */
require.config({
  waitSeconds: 60,
  paths: {
    jquery: "vendor/jquery",
    braintree: "https://js.braintreegateway.com/v2/braintree",
    braintreeClient: "https://js.braintreegateway.com/web/3.60.0/js/client.min",
    hostedFields:
      "https://js.braintreegateway.com/web/3.60.0/js/hosted-fields.min",
  },
});
define(["jquery", 'braintree', "braintreeClient", "hostedFields"], function (
  $,
  braintree,
  client,
  hostedFields
) {
  "use strict";

  return {
    init: function (config) {
      this.client_token = config.client_token;
      this.client = null;
      this.postUrl = config.postUrl;
      this.$paymentForm = $("#paymentForm");
      this.paymentRequestConfig = {
        country: config.country,
        currency: config.paymentRequest.currency,
        total: {
          label: config.paymentRequest.label,
          amount: config.paymentRequest.total,
        },
      };
      client.create({
        authorization: this.client_token
      }, function (clientErr, clientInstance) {
        if (clientErr) {
          console.log(clientErr);
          return;
        }
        // alert('balle balle')
        window.BraintreeConfig.client = clientInstance
      });
      this.$paymentForm.on("submit", $.proxy(this.onPaymentFormSubmit, this));
      //this.initializePaymentRequest();
    },

    onPaymentFormSubmit: function (e) {
      var data = {},
        fieldMappings = {
          "card-number": "number",
          "card-expiry-month": "exp_month",
          "card-expiry-year": "exp_year",
          "card-cvn": "cvc",
          id_postal_code: "address_zip",
          id_address_line1: "address_line1",
          id_address_line2: "address_line2",
          id_city: "address_city",
          id_state: "address_state",
          id_country: "address_country",
        },
        $paymentForm = $("#paymentForm");
      // Extract the form data so that it can be incorporated into our token request
      Object.keys(fieldMappings).forEach(function (id) {
        data[fieldMappings[id]] = $("#" + id, $paymentForm).val();
      });

      data.name = $("#id_first_name").val() + " " + $("#id_last_name").val();

      // Disable the submit button to prevent repeated clicks
      $paymentForm.find("#payment-button").prop("disabled", true);

      // Request a token from Braintree
      // window.BraintreeConfig["hostedFieldsInstance"].tokenize(
      //   data,
      //   $.proxy(this.onCreateCardToken, this)
      // );
      e.preventDefault();
      var values = {
        number: data.number,
        expirationDate: data.exp_month + '/' + data.exp_year,
        cvv: data.cvc,
        billingAddress: {
          postalCode: data.address_zip
        }
      }
      window.BraintreeConfig.client.request({
        endpoint: 'payment_methods/credit_cards',
        method: 'post',
        data: {
          creditCard: values
        }
      }, $.proxy(this.onCreateCardToken, this))
    },

    onCreateCardToken: function (err, result) {
      var rawRequestError;

      if (err) {
        rawRequestError = err.details.originalError;

        if (rawRequestError.fieldErrors && rawRequestError.fieldErrors.length > 0) {
          renderFieldErrors(rawRequestError.fieldErrors[0].fieldErrors);
        } else {
          console.log('Something unexpected went wrong.');
          console.log(err);
        }
        this.$paymentForm.find("#payment-button").prop("disabled", false); // Re-enable submission
        return;
      }

      else {
        // alert("Got nonce:", result.creditCards[0].nonce);
        console.log("Got nonce:", result.creditCards[0].nonce);
        this.postTokenToServer(result.creditCards[0].nonce);
      }
    },

    postTokenToServer: function (token, paymentRequest) {
      var self = this,
        formData = new FormData();

      formData.append("payment_method_nonce", token);
      formData.append(
        "csrfmiddlewaretoken",
        $("[name=csrfmiddlewaretoken]", self.$paymentForm).val()
      );
      formData.append("basket", $("[name=basket]", self.$paymentForm).val());

      fetch(self.postUrl, {
        credentials: "include",
        method: "POST",
        body: formData,
      }).then(function (response) {
        if (response.ok) {
          if (paymentRequest) {
            // Report to the browser that the payment was successful, prompting
            // it to close the browser payment interface.
            paymentRequest.complete("success");
          }
          response.json().then(function (data) {
            window.location.href = data.url;
          });
        } else {
          if (paymentRequest) {
            // Report to the browser that the payment failed, prompting it to re-show the payment
            // interface, or show an error message and close the payment interface.
            paymentRequest.complete("fail");
          }

          self.displayErrorMessage(
            gettext(
              "An error occurred while processing your payment. " +
              "Please try again."
            )
          );
        }
      });
    },

    displayErrorMessage: function (message) {
      $("#messages").html(
        _s.sprintf(
          '<div class="alert alert-error"><i class="icon fa fa-exclamation-triangle"></i>%s</div>',
          message
        )
      );
    },

    initializePaymentRequest: function () {
      var self = this,
        paymentRequest = self.stripe.paymentRequest(this.paymentRequestConfig),
        elements = self.stripe.elements(),
        paymentRequestButton = elements.create("paymentRequestButton", {
          paymentRequest: paymentRequest,
          style: {
            paymentRequestButton: {
              height: "50px",
            },
          },
        });

      // Check the availability of the Payment Request API first.
      paymentRequest.canMakePayment().then(function (result) {
        if (result) {
          paymentRequestButton.mount("#payment-request-button");
        } else {
          document.getElementById("payment-request-button").style.display =
            "none";
        }
      });

      paymentRequest.on("token", function (ev) {
        self.postTokenToServer(ev.token.id, ev);
      });
    },
  };
});
