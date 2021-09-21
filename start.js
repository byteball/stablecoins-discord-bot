const DAG = require('aabot/dag.js');
const conf = require('ocore/conf.js');
const network = require('ocore/network.js');
const eventBus = require('ocore/event_bus.js');
const lightWallet = require('ocore/light_wallet.js');
const walletGeneral = require('ocore/wallet_general.js');
const governanceEvents = require('governance_events/governance_events.js');
const governanceDiscord = require('governance_events/governance_discord.js');

var assocStablecoinsGovernanceAAs = {};
var assocCurveAAs = {};

lightWallet.setLightVendorHost(conf.hub);

eventBus.once('connected', function(ws){
	network.initWitnessesIfNecessary(ws, start);
});

async function start(){
	await discoverGovernanceAas();
	eventBus.on('connected', function(ws){
		conf.stablecoins_governance_base_AAs_V1
		.concat(conf.stablecoins_governance_base_AAs_V2)
		.forEach((address) => {
			network.addLightWatchedAa(address, null, console.log);
		});
	});
	lightWallet.refreshLightClientHistory();
	setInterval(discoverGovernanceAas, 24*3600*1000); // everyday check
}

eventBus.on('aa_response', async function(objResponse){
	if(objResponse.response.error)
		return console.log('ignored response with error: ' + objResponse.response.error);
	if ((Math.ceil(Date.now() / 1000) - objResponse.timestamp) / 60 / 60 > 24)
		return console.log('ignored old response' + objResponse);
	if (assocStablecoinsGovernanceAAs[objResponse.aa_address]){
		const governance_aa = assocStablecoinsGovernanceAAs[objResponse.aa_address];
		const main_aa = assocCurveAAs[governance_aa.curveAAAddress];
		const asset = governance_aa.version === 1 ? main_aa.asset1 : main_aa.fund_asset;
		
		const event = await governanceEvents.treatResponseFromGovernanceAA(objResponse, asset);

		const aa_name = main_aa.aa_address + (main_aa.asset2_symbol ? (' - ' + main_aa.asset2_symbol) : '') + ' - ' + main_aa.interest_rate * 100 + '%';
		const symbol = governance_aa.version === 1 ? main_aa.asset1_symbol : main_aa.fund_asset_symbol;
		const decimals = governance_aa.version === 1 ? main_aa.asset1_decimals : main_aa.reserve_asset_decimals;
		governanceDiscord.announceEvent(aa_name, symbol, decimals, conf.stablecoins_base_url + main_aa.aa_address + '/governance', event);
	}
});

async function discoverGovernanceAas(){
	let rows = await DAG.getAAsByBaseAAs(conf.stablecoins_governance_base_AAs_V1.concat(conf.stablecoins_governance_base_AAs_V2));
	await Promise.all(rows.map(indexAndWatchStablecoinsGovernanceAA));
}

async function indexAndWatchStablecoinsGovernanceAA(governanceAA){
	return new Promise(async function(resolve){
		const curveAAAddress = governanceAA.definition[1].params.curve_aa;
		const version = (conf.stablecoins_governance_base_AAs_V1.includes(governanceAA.definition[1].base_aa) ? 1 : 2);

		await indexAllCurveAaParams(curveAAAddress);
		assocStablecoinsGovernanceAAs[governanceAA.address] = {
			curveAAAddress: curveAAAddress,
			version: version
		}

		walletGeneral.addWatchedAddress(governanceAA.address, resolve);
	});
}

async function indexAllCurveAaParams(curveAAAddress){
	const curveAADefinition = await DAG.readAADefinition(curveAAAddress);
	const reserve_asset = curveAADefinition[1].params.reserve_asset;
	const curveAAVars = await DAG.readAAStateVars(curveAAAddress);
	let fundAsset, fund_asset_symbol;
	if (curveAAVars.fund_aa) {
		fundAsset = await DAG.readAAStateVar(curveAAVars.fund_aa, "shares_asset");
		fund_asset_symbol = await DAG.readAAStateVar(conf.token_registry_AA_address, 'a2s_' + fundAsset);
	}
	const vars = await readStateVarsForPrefixes(conf.token_registry_AA_address, [
		'a2s_' + curveAAVars.asset1,
		'a2s_' + curveAAVars.asset2,
		'a2s_' + reserve_asset,
		'current_desc_' + reserve_asset
	]);
	const asset1_symbol = vars['a2s_' + curveAAVars.asset1];
	const asset2_symbol = vars['a2s_' + curveAAVars.asset2];
	const reserve_asset_symbol = vars['a2s_' + reserve_asset];
	const current_desc = vars['current_desc_' + reserve_asset];
	const reserve_asset_decimals = await DAG.readAAStateVar(conf.token_registry_AA_address, 'decimals_' + current_desc);

	assocCurveAAs[curveAAAddress] = {
		aa_address: curveAAAddress,
		governance_aa: curveAAVars.governance_aa,
		asset1: curveAAVars.asset1,
		asset2: curveAAVars.asset2,
		interest_rate: curveAAVars.interest_rate,
		asset1_decimals: curveAADefinition[1].params.decimals1,
		asset2_decimals: curveAADefinition[1].params.decimals2,
		asset1_symbol: asset1_symbol,
		asset2_symbol: asset2_symbol,
		reserve_asset: reserve_asset,
		reserve_asset_decimals: reserve_asset == 'base' ? 9 : reserve_asset_decimals,
		reserve_asset_symbol: reserve_asset == 'base' ? 'GB' : reserve_asset_symbol,
		leverage: curveAADefinition[1].params.leverage || 0
	}
	if (fundAsset) {
		assocCurveAAs[curveAAAddress].fund_asset = fundAsset;
		assocCurveAAs[curveAAAddress].fund_asset_symbol = fund_asset_symbol;
	}		
}

function readStateVarsForPrefixes(aa_address, arrPrefixes){
	return new Promise(function(resolve){
		Promise.all(arrPrefixes.map((prefix)=>{
			return DAG.readAAStateVars(aa_address, prefix)
		})).then((arrResults)=>{
			return resolve(Object.assign({}, ...arrResults));
		}).catch((error)=>{
			return resolve({});
		});
	});
}

function handleJustsaying(ws, subject, body) {
	switch (subject) {
		case 'light/have_updates':
			lightWallet.refreshLightClientHistory();
			break;
	}
}
eventBus.on("message_for_light", handleJustsaying);

process.on('unhandledRejection', up => { throw up });