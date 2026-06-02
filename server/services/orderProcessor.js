const data = require("../data");
const { validateCartItems } = require("./cartValidation");

module.exports = {
  validateCartItems: (items) => validateCartItems(items, data.getVariant),
  validateReferralCode: data.validateReferralCode,
  createPendingOrder: data.createPendingOrder,
  fulfillOrder: data.fulfillOrder,
};
