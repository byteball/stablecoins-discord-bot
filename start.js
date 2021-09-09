const conf = require('ocore/conf.js');
const network = require('ocore/network.js');
const eventBus = require('ocore/event_bus.js');
const lightWallet = require('ocore/light_wallet.js');
const storage = require('ocore/storage.js');
const walletGeneral = require('ocore/wallet_general.js');
const objectHash = require('ocore/object_hash.js');
const announcements = require('./announcements.js');
const crypto = require('crypto');
const db = require('ocore/db.js');
const DAG = require('aabot/dag.js');

var assocGovernanceAAs = {};
var assocCurveAAs = {};

lightWallet.setLightVendorHost(conf.hub);

eventBus.once('connected', function(ws){
	network.initWitnessesIfNecessary(ws, start);
});

async function start(){
	await discoverGovernanceAas();
	eventBus.on('connected', function(ws){
		conf.governance_base_AAs_V1.concat(conf.governance_base_AAs_V2).forEach((address) => {
			network.addLightWatchedAa(address, null, console.log);
		});
	});
	lightWallet.refreshLightClientHistory();
	setInterval(discoverGovernanceAas, 24*3600*1000); // everyday check
}

function getValueKey(value){
	return ('support_' + 'oracles' +'_' + value+ '_'+ 32).length > 128 ? 
	crypto.createHash("sha256").update(value, "utf8").digest("base64") : value;
}

async function treatResponseFromGovernanceAA(objResponse){
	const objTriggerJoint = await DAG.readJoint(objResponse.trigger_unit);
	if (!objTriggerJoint)
		throw Error('trigger unit not found ' + objResponse.trigger_unit);
	const objTriggerUnit = objTriggerJoint.unit;

	const data = getTriggerUnitData(objTriggerUnit);
	const governanceAAAddress = objResponse.aa_address;
	const governanceAA = assocGovernanceAAs[governanceAAAddress];
	if (data.name){
		if (data.commit) {
			var registryVars = await getStateVarsForPrefixes(governanceAAAddress, [data.name]);
			var value = registryVars[data.name];
			return announcements.announceCommitedValue(assocCurveAAs[governanceAA.curveAAAddress], objResponse.trigger_address, data.name, value, objResponse.trigger_unit);
		}
		if (data.value === undefined){
			const leader_key = 'leader_' + data.name;
			var registryVars = await getStateVarsForPrefixes(governanceAAAddress, [leader_key]);
			const leader = registryVars[leader_key];
			const leader_support_key = 'support_' + data.name + '_' + leader;
			registryVars = await getStateVarsForPrefixes(governanceAAAddress, [leader_support_key]);
			const leader_support = registryVars[leader_support_key];
			return announcements.announceRemovedSupport(assocCurveAAs[governanceAA.curveAAAddress], objResponse.trigger_address, data.name, leader, 
			leader_support, objResponse.trigger_unit, governanceAA.version);
		}
		const support_key = 'support_' + data.name + '_' + getValueKey(data.value);
		const leader_key = 'leader_' + data.name;
		var registryVars = await getStateVarsForPrefixes(governanceAAAddress, [leader_key, support_key]);

		const support = registryVars[support_key];
		const leader = registryVars[leader_key];
		const leader_support_key = 'support_' + data.name + '_' + leader;
		const balance_key = 'balance_' + objResponse.trigger_address;
		registryVars = await getStateVarsForPrefixes(governanceAAAddress, [leader_support_key, balance_key]);
		const leader_support = registryVars[leader_support_key];
		const added_amount = registryVars[balance_key];

		return announcements.announceAddedSupport(assocCurveAAs[governanceAA.curveAAAddress], objResponse.trigger_address, added_amount, data.name, data.value,
			support, leader, leader_support, objResponse.trigger_unit, governanceAA.version);
	}
	if (data.withdraw) {
		var amount = data.amount;
		return announcements.announceWithdrawn(assocCurveAAs[governanceAA.curveAAAddress], objResponse.trigger_address, amount, objResponse.trigger_unit, governanceAA.version);
	}
}

eventBus.on('aa_response', function(objResponse){
	if(objResponse.response.error)
		return console.log('ignored response with error: ' + objResponse.response.error);
	if ((Math.ceil(Date.now() / 1000) - objResponse.timestamp) / 60 / 60 > 24)
		return console.log('ignored old response' + objResponse);
	if (assocGovernanceAAs[objResponse.aa_address]){
		treatResponseFromGovernanceAA(objResponse);
	}
});

async function discoverGovernanceAas(){
	const rows = await DAG.getAAsByBaseAAs(conf.governance_base_AAs_V1.concat(conf.governance_base_AAs_V2));
	await Promise.all(rows.map(indexAndWatchGovernanceAA));
}

async function indexAndWatchGovernanceAA(governanceAA){
	return new Promise(async function(resolve){
		const curveAAAddress = governanceAA.definition[1].params.curve_aa;
		const version = (conf.governance_base_AAs_V1.includes(governanceAA.definition[1].base_aa) ? 1 : 2);

		await indexAllCurveAaParams(curveAAAddress);
		assocGovernanceAAs[governanceAA.address] = {
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

	let fundAsset;
	if (curveAAVars.fund_aa)
		fundAsset = await DAG.readAAStateVar(curveAAVars.fund_aa, "shares_asset");

	var registryVars = await getStateVarsForPrefixes(conf.token_registry_AA_address, [
		'a2s_' + curveAAVars.asset1, 
		'a2s_' + curveAAVars.asset2, 
		'a2s_' + reserve_asset, 
		'a2s_' + fundAsset,
		'current_desc_' + reserve_asset
	]);
	const current_desc = registryVars['current_desc_' + reserve_asset];
	registryVars = Object.assign(registryVars, await getStateVarsForPrefixes(conf.token_registry_AA_address, ['decimals_' + current_desc]));

	assocCurveAAs[curveAAAddress] = {
		aa_address: curveAAAddress,
		governance_aa: curveAAVars.governance_aa,
		asset1: curveAAVars.asset1,
		asset2: curveAAVars.asset2,
		interest_rate: curveAAVars.interest_rate,
		asset1_decimals: curveAADefinition[1].params.decimals1,
		asset2_decimals: curveAADefinition[1].params.decimals2,
		asset1_symbol: registryVars['a2s_' + curveAAVars.asset1],
		asset2_symbol: registryVars['a2s_' + curveAAVars.asset2],
		reserve_asset: reserve_asset,
		reserve_asset_decimals: reserve_asset == 'base' ? 9 : registryVars['decimals_' + current_desc],
		reserve_asset_symbol: reserve_asset == 'base' ? 'GB' : registryVars['a2s_' + reserve_asset],
		leverage: curveAADefinition[1].params.leverage || 0
	}
	if (fundAsset) {
		assocCurveAAs[curveAAAddress].fund_asset = fundAsset;
		assocCurveAAs[curveAAAddress].fund_asset_symbol = registryVars['a2s_' + fundAsset];
	}		
}

function getStateVarsForPrefixes(aa_address, arrPrefixes){
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

function getTriggerUnitData(objTriggerUnit){
	for (var i=0; i < objTriggerUnit.messages.length; i++)
	if (objTriggerUnit.messages[i].app === 'data') // AA considers only the first data message
		return objTriggerUnit.messages[i].payload;
	return {};
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