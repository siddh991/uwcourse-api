/*
This module contains parsers for text that is related to courses like the catalog number
 */

const CATALOG_EXP_STRING = "([A-Z])\s\d{3}\*?";

const CATALOG_EXP_CASE_SENSITIVE = new RegExp(CATALOG_EXP_STRING);
const CATALOG_EXP_CASE_INSENSITIVE = new RegExp(CATALOG_EXP_STRING, "i");

exports.CATALOG_EXP_STRING = CATALOG_EXP_STRING;
exports.CATALOG_EXP_CASE_SENSITIVE = CATALOG_EXP_CASE_SENSITIVE;
exports.CATALOG_EXP_CASE_INSENSITIVE = CATALOG_EXP_CASE_INSENSITIVE;

exports.parse_catalog = (text, options) => {
    options = Object.assign({
        case_sensitive: true
    }, options);

    let CATALOG_EXP = options.case_sensitive ? CATALOG_EXP_CASE_SENSITIVE : CATALOG_EXP_CASE_INSENSITIVE;

    let
};
