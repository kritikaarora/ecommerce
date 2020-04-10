/* istanbul ignore next */
require(["jquery", "payment_processors/braintree"], function (
  $,
  BraintreeProcessor
) {
  "use strict";

  $(document).ready(function () {
    BraintreeProcessor.init(window.BraintreeConfig);
  });
});
