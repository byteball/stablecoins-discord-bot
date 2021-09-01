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
		network.addLightWatchedAa(conf.governance_base_aa, null, console.log);
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
		if (data.value === undefined){
			const leader_key = 'leader_' + data.name;
			var registryVars = await getStateVarsForPrefixes(governanceAAAddress, [leader_key]);
			const leader = registryVars[leader_key];
			const leader_support_key = 'leader_' + leader;
			registryVars = await getStateVarsForPrefixes(governanceAAAddress, [leader_support_key]);
			const leader_support = registryVars[leader_support_key];
			return announcements.announceRemovedSupport(assocCurveAAs[governanceAA.curveAAAddress], objResponse.trigger_address, data.name, leader, 
			leader_support, objResponse.trigger_unit);
		}
		const support_key = 'support_' + data.name + '_' + getValueKey(data.value);
		const leader_key = 'leader_' + data.name;
		var registryVars = await getStateVarsForPrefixes(governanceAAAddress, [leader_key, support_key]);

		const support = registryVars[support_key];
		const leader = registryVars[leader_key];
		const leader_support_key = 'leader_' + leader;
		registryVars = await getStateVarsForPrefixes(governanceAAAddress, [leader_support_key]);
		const leader_support = registryVars[leader_support_key];

		const amountToAa = getAmountToAa(objTriggerUnit, governanceAAAddress, governanceAA.asset);

		return announcements.announceAddedSupport(assocCurveAAs[governanceAA.curveAAAddress], objResponse.trigger_address, amountToAa, data.name,data.value,
			support, leader, leader_support, objResponse.trigger_unit);
	}
}

eventBus.on('aa_response', function(objResponse){
	console.log('---------------------------------------------- aa_response ');
	if(objResponse.response.error)
		return console.log('ignored response with error: ' + objResponse.response.error);
	if (assocGovernanceAAs[objResponse.aa_address]){
		treatResponseFromGovernanceAA(objResponse);
	}
});

async function discoverGovernanceAas(){
	const rows = await DAG.getAAsByBaseAAs([conf.governance_base_aa]);
	await Promise.all(rows.map(indexAndWatchGovernanceAA));
}

async function indexAndWatchGovernanceAA(governanceAA){
	return new Promise(async function(resolve){
		const curveAAAddress = governanceAA.definition[1].params.curve_aa;
		await indexAllCurveAaParams(curveAAAddress);

		assocGovernanceAAs[governanceAA.address] = {
			curveAAAddress: curveAAAddress
		}
		walletGeneral.addWatchedAddress(governanceAA.address, resolve);
		console.log('stablecoinds-discord-bot: added governance AA', assocGovernanceAAs[governanceAA.address]);
	});
}

async function indexAllCurveAaParams(curveAAAddress){
	const curveAADefinition = await DAG.readAADefinition(curveAAAddress);
	const reserve_asset = curveAADefinition[1].params.reserve_asset;

	const curveAAVars = await DAG.readAAStateVars(curveAAAddress);
	var registryVars = await getStateVarsForPrefixes(conf.token_registry_aa_address, [
		'a2s_' + curveAAVars.asset1, 
		'a2s_' + curveAAVars.asset2, 
		'a2s_' + reserve_asset, 
		'current_desc_' + reserve_asset
	]);
	const current_desc = registryVars['current_desc_' + reserve_asset];
	registryVars = Object.assign(registryVars, await getStateVarsForPrefixes(conf.token_registry_aa_address, ['decimals_' + current_desc]));
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
	console.log('stablecoinds-discord-bot: added curve AA', assocCurveAAs[curveAAAddress]);
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

function getAmountToAa(objTriggerUnit, aa_address, asset = 'base'){
	if (!objTriggerUnit)
		return 0;
	let amount = 0;
	objTriggerUnit.messages.forEach(function (message){
		if (message.app !== 'payment')
			return;
		const payload = message.payload;
		if (asset == 'base' && payload.asset || asset != 'base' && asset !== payload.asset)
			return;
		payload.outputs.forEach(function (output){
			if (output.address === aa_address) {
				amount += output.amount; // in case there are several outputs
			}
		});
	});
	return amount;
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