"use strict";
const path = require('path');
require('dotenv').config({ path: path.dirname(process.mainModule.paths[0]) + '/.env' });

exports.bServeAsHub = false;
exports.bLight = true;

exports.discord_token = process.env.discord_token;
exports.discord_channels = [process.env.channel];

exports.hub = process.env.testnet ? 'obyte.org/bb-test' : 'obyte.org/bb';
exports.explorer_base_url = process.env.testnet ? 'https://testnetexplorer.obyte.org/#' : 'https://explorer.obyte.org/#';
exports.stablecoins_base_url = process.env.testnet ? 'https://testnet.ostable.org/trade/' : 'https://ostable.org/trade/';

exports.curve_base_aa = process.env.testnet ? "FCFYMFIOGS363RLDLEWIDBIIBU7M7BHP" : "FCFYMFIOGS363RLDLEWIDBIIBU7M7BHP";
exports.governance_base_aa = process.env.testnet ? "Y4VBXMROK5BWBKSYYAMUW7QUEZFXYBCF" : "Y4VBXMROK5BWBKSYYAMUW7QUEZFXYBCF";
exports.deposit_base_aa = process.env.testnet ? "GEZGVY4T3LK6N4NJAKNHNQIVAI5OYHPC" : "GEZGVY4T3LK6N4NJAKNHNQIVAI5OYHPC";
exports.token_registry_aa_address = process.env.testnet ? "O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ" : "O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ";

console.log('finished server conf');
