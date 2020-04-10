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
define(["jquery", "braintreeClient", "hostedFields"], function (
  $,
  client,
  hostedFields
) {
  "use strict";

  return {
    init: function (config) {
      this.client_token = config.client_token;
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
      client.create(
        {
          authorization: this.client_token,
        },
        function (err, clientInstance) {
          if (err) {
            displayErrorMessage(err);
            console.log(err);
            return;
          } else {
            hostedFields.create(
              {
                client: clientInstance,
                styles: {
                  input: {
                    // change input styles to match
                    // bootstrap styles
                    "font-size": "1rem",
                    color: "#495057",
                  },
                },
                fields: {
                  number: {
                    selector: "#card-number",
                    placeholder: "4111 1111 1111 1111",
                  },
                  cvv: {
                    selector: "#card-cvn",
                    placeholder: "123",
                  },
                  expirationDate: {
                    selector: "#expiration-date",
                    placeholder: "MM / YY",
                  },
                },
              },
              function (err, hostedFieldsInstance) {
                if (err) {
                  console.error(err);
                  displayErrorMessage(err);
                  return;
                } else {
                  console.log(hostedFieldsInstance);
                  window.BraintreeConfig[
                    "hostedFieldsInstance"
                  ] = hostedFieldsInstance;
                }
              }
            );
          }
        }
      );
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
      window.BraintreeConfig["hostedFieldsInstance"].tokenize(
        data,
        $.proxy(this.onCreateCardToken, this)
      );

      e.preventDefault();
    },

    onCreateCardToken: function (tokenizeErr, payload) {
      if (tokenizeErr) {
        switch (tokenizeErr.code) {
          case "HOSTED_FIELDS_FIELDS_EMPTY":
            console.error("All fields are empty! Please fill out the form.");
            msg =
              gettext("All fields are empty! Please fill out the form.") +
              "<br><br>Debug Info: " +
              tokenizeErr.code;
            break;
          case "` `":
            console.error(
              "Some fields are invalid:",
              tokenizeErr.details.invalidFieldKeys
            );
            msg =
              gettext(
                "Some fields are invalid:" +
                  tokenizeErr.details.invalidFieldKeys
              ) +
              "<br><br>Debug Info: " +
              tokenizeErr.code;
            break;
          case "HOSTED_FIELDS_FAILED_TOKENIZATION":
            console.error(
              "Tokenization failed server side. Is the card valid?"
            );
            msg =
              gettext("okenization failed server side. Is the card valid?") +
              "<br><br>Debug Info: " +
              tokenizeErr.code;
            break;
          case "HOSTED_FIELDS_TOKENIZATION_NETWORK_ERROR":
            console.error("Network error occurred when tokenizing.");
            msg =
              gettext("Network error occurred when tokenizing.") +
              "<br><br>Debug Info: " +
              tokenizeErr.code;
            break;
          default:
            console.error("Something bad happened!", tokenizeErr);
            msg =
              gettext("Something bad happened!") +
              "<br><br>Debug Info: " +
              tokenizeErr.code;
        }
        this.displayErrorMessage(msg);
        this.$paymentForm.find("#payment-button").prop("disabled", false); // Re-enable submission
      } else {
        alert("Got nonce:", payload.nonce);
        console.log("Got nonce:", payload.nonce);
        this.postNonceToServer(payload.nonce);
      }
    },

    postTokenToServer: function (token, paymentRequest) {
      var self = this,
        formData = new FormData();

      formData.append("stripe_token", token);
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
