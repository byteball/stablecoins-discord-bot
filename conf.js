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

exports.governance_base_AAs_V1 = [
	'Y4VBXMROK5BWBKSYYAMUW7QUEZFXYBCF', 'UUPBIWDWQ7Q4WXS5CWSEKUQE34FG6L55'
];
exports.governance_base_AAs_V2 = [
	'JL6OOEOQCJ2RJ3NHCUJLUBDR3ZE3GY3F', 'LXHUYEV6IHBCTGMFNSWRBBU7DGR3JTIY'
];
exports.token_registry_AA_address = "O6H6ZIFI57X3PLTYHOCVYPP5A553CYFQ";

console.log('finished server conf');
