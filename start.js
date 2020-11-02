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

var assocCurveAas = {};

var assocDepositsAas = {};
var assocDepositsAasByCurves = {};

var assocGovernanceAas = {};


lightWallet.setLightVendorHost(conf.hub);

eventBus.once('connected', function(ws){
	network.initWitnessesIfNecessary(ws, start);
});


function getValueKey(value){
	return ('support_' + 'oracles' +'_' + value+ '_'+ 32).length > 128 ? 
	crypto.createHash("sha256").update(value, "utf8").digest("base64") : value;
}

async function treatResponseFromGovernanceAA(objResponse){

	const objTriggerUnit = await getJointFromStorageOrHub(objResponse.trigger_unit);
	if (!objTriggerUnit)
		throw Error('trigger unit not found ' + objResponse.trigger_unit);
	const data = getTriggerUnitData(objTriggerUnit);
	const governanceAaAddress = objResponse.aa_address;
	const governanceAa = assocGovernanceAas[governanceAaAddress];
	if (data.name){
		if (data.value === undefined){
			const leader_key = 'leader_' + data.name;
			var registryVars = await getStateVarsForPrefixes(governanceAaAddress, [leader_key]);
			const leader = registryVars[leader_key];
			const leader_support_key = 'leader_' + leader;
			registryVars = await getStateVarsForPrefixes(governanceAaAddress, [leader_support_key]);
			const leader_support = registryVars[leader_support_key];
			return announcements.announceRemovedSupport(assocCurveAas[governanceAa.curveAaAddress], objResponse.trigger_address, data.name, leader, 
			leader_support, objResponse.trigger_unit);
		}
		const support_key = 'support_' + data.name + '_' + getValueKey(data.value);
		const leader_key = 'leader_' + data.name;
		var registryVars = await getStateVarsForPrefixes(governanceAaAddress, [leader_key, support_key]);

		const support = registryVars[support_key];
		const leader = registryVars[leader_key];
		const leader_support_key = 'leader_' + leader;
		registryVars = await getStateVarsForPrefixes(governanceAaAddress, [leader_support_key]);
		const leader_support = registryVars[leader_support_key];

		const amountToAa = getAmountToAa(objTriggerUnit, governanceAaAddress, governanceAa.asset);

		return announcements.announceAddedSupport(assocCurveAas[governanceAa.curveAaAddress], objResponse.trigger_address, amountToAa, data.name,data.value,
			support, leader, leader_support, objResponse.trigger_unit);
	}

}


async function treatResponseFromDepositsAA(objResponse){

	const objTriggerUnit = await getJointFromStorageOrHub(objResponse.trigger_unit);
	if (!objTriggerUnit)
		throw Error('trigger unit not found ' + objResponse.trigger_unit);
	const data = getTriggerUnitData(objTriggerUnit);

	const objResponseUnit = objResponse.response_unit ? await getJointFromStorageOrHub(objResponse.response_unit) : null;
	const depositAaAddress = objResponse.aa_address;
	const depositsAa = assocDepositsAas[depositAaAddress]
	const curveAaAddress = depositsAa.curveAaAddress;
	const curveAa = assocCurveAas[curveAaAddress];
	if (objResponse.response.responseVars && objResponse.response.responseVars.id){
		const deposit_id = 'deposit_' + objResponse.response.responseVars.id;
		const vars = await getStateVarsForPrefix(depositAaAddress, deposit_id);
		if (!vars[deposit_id])
			return console.log('no vars found for deposit ' + deposit_id);
		return announcements.announceNewDeposit(curveAa, depositsAa, vars[deposit_id].amount, vars[deposit_id].stable_amount, vars[deposit_id].owner, objResponse.trigger_unit);
	} 

	var stable_amount_to_aa = getAmountToAa(objTriggerUnit, depositAaAddress, depositsAa.asset) - getAmountFromAa(objResponseUnit, depositAaAddress, depositsAa.asset)
	const interest_amount_from_aa = getAmountFromAa(objResponseUnit, depositAaAddress, curveAa.asset2);

	if (stable_amount_to_aa > 0 && data.id){
		if (interest_amount_from_aa > 0){
			const vars = getStateVarsForPrefix(depositAaAddress, 'deposit_' + data.id + '_force_close');
			if (vars[ 'deposit_' + data.id + '_force_close'])
				return announcements.announceForceClosePending(curveAa, depositsAa, objResponse.trigger_address, data.id,  
					stable_amount_to_aa, objResponse.trigger_unit);

			return announcements.announceClosingDeposit(curveAa, depositsAa, objResponse.trigger_address, data.id,  
				stable_amount_to_aa, interest_amount_from_aa, objResponse.trigger_unit);
		}
	}

	if (data.commit_force_close && data.id){
		const rows = await db.query("SELECT response_unit FROM aa_responses WHERE trigger_unit=? AND aa_address=?", [data.id, depositAaAddress])
		if (!rows[0])
			return console.log("deposit response unit not found")
		const objDepositResponseUnit = await getJointFromStorageOrHub(rows[0].response_unit);
		if (!objDepositResponseUnit)
			throw Error('response unit not found ' + data.id);
		const objDepositTriggerUnit = await getJointFromStorageOrHub(objDepositResponseUnit.trigger_unit);
		stable_amount_to_aa = getAmountFromAa(objDepositResponseUnit, depositAaAddress, depositsAa.asset); // the amount to AA is the same as the amount that was initially minted
		return announcements.announceClosingDeposit(curveAa, depositsAa, objDepositTriggerUnit.trigger_address, data.id,  
			stable_amount_to_aa, interest_amount_from_aa, objResponse.trigger_unit);
	}
	
}

async function treatResponseFromCurveAA(objResponse){
	const objTriggerUnit = await getJointFromStorageOrHub(objResponse.trigger_unit);
	if (!objTriggerUnit)
		throw Error('trigger unit not found ' + objResponse.trigger_unit);
	const objResponseUnit = objResponse.response_unit ? await getJointFromStorageOrHub(objResponse.response_unit) : null;
	const data = getTriggerUnitData(objTriggerUnit);
	const curveAa = assocCurveAas[objResponse.aa_address];
	const curveAaAddress = objResponse.aa_address;
	if (data.move_capacity && objResponse.response.amount)
		return announcements.announceMovedCapacity(curveAa, objResponse.trigger_address, objResponse.response.amount, objResponse.trigger_unit);
	if (objResponse.trigger_address == curveAa.governance_aa && data.name){
		announcements.announceParameterChange(curveAa, data.name, data.value);
		return;
	}
	if (objResponse.trigger_address == curveAa.governance_aa && data.grant && data.recipient && data.amount)
		return announcements.announceGrantAttributed(curveAa, data.grant, data.recipient, data.amount);
	if (objResponse.response.responseVars && objResponse.response.responseVars.p2){
		const reserve_added = getAmountToAa(objTriggerUnit, curveAaAddress, curveAa.reserve_asset) - getAmountFromAa(objResponseUnit, curveAaAddress, curveAa.reserve_asset); // can be negative
		const asset1_added = getAmountFromAa(objResponseUnit, curveAaAddress, curveAa.asset1) - getAmountToAa(objTriggerUnit, curveAaAddress, curveAa.asset1); // can be negative
		const asset2_added = getAmountFromAa(objResponseUnit, curveAaAddress, curveAa.asset2) - getAmountToAa(objTriggerUnit, curveAaAddress, curveAa.asset2); // can be negative

	//	return announcements.announceSupplyChange(curveAa, reserve_added, asset1_added, asset2_added, objResponse.response.responseVars.p2, objResponse.response.responseVars.target_p2, objResponse.trigger_unit)
	}

}


eventBus.on('aa_response', function(objResponse){
	console.log('---------------------------------------------- aa_response ');
	if(objResponse.response.error)
		return console.log('ignored response with error: ' + objResponse.response.error);
	const aa_address = objResponse.aa_address;

	if (assocCurveAas[aa_address]){
		treatResponseFromCurveAA(objResponse);
	}

	if (assocDepositsAas[aa_address]){
		treatResponseFromDepositsAA(objResponse);
	}

	if (assocGovernanceAas[aa_address]){
		treatResponseFromGovernanceAA(objResponse);
	}

});

function getAmountFromAa(objResponseUnit, aa_address, asset = 'base'){
	if (!objResponseUnit)
		return 0;
	let amount = 0;
	objResponseUnit.messages.forEach(function (message){
		if (message.app !== 'payment')
			return;
		const payload = message.payload;
		if (asset == 'base' && payload.asset || asset != 'base' && asset !== payload.asset)
			return;
		payload.outputs.forEach(function (output){
			if (output.address !== aa_address) {
				amount += output.amount; 
			} 
		});
	});
	return amount;
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




async function start(){
	await lookForExistingStablecoins()
	eventBus.on('connected', function(ws){
		network.addLightWatchedAa(conf.curve_base_aa, null, console.log);
	});
	lightWallet.refreshLightClientHistory();
	setInterval(lookForExistingStablecoins, 24*3600*1000); // everyday check new symbols
}

async function lookForExistingStablecoins(){
	await discoverCurveAas();
	await discoverDepositAas();
}


function discoverDepositAas(){
	return new Promise(function(resolve){
		network.requestFromLightVendor('light/get_aas_by_base_aas', {
			base_aa: conf.deposit_base_aa
		}, async function(ws, request, arrResponse){
			await Promise.all(arrResponse.map(indexAndWatchDepositsAa));
			resolve();
		});
	});
}

function indexAndWatchDepositsAa(objAa){
	return new Promise(async function(resolve){
		await indexAllDepositsParams(objAa);
		walletGeneral.addWatchedAddress(objAa.address, resolve);
	});
}

async function indexAndWatchCurveAa(objAa){
	return new Promise(async function(resolve){
		await indexAllCurveAaParams(objAa);
		walletGeneral.addWatchedAddress(objAa.address, resolve);
	});
}

async function indexAllDepositsParams(objAa){
	const depositsAaAddress = objAa.address;
	const curveAaAddress = objAa.definition[1].params.curve_aa;

	const vars = await getStateVars(depositsAaAddress);
	const asset = vars['asset'];
	var registryVars = await getStateVarsForPrefixes(conf.token_registry_aa_address, ['a2s_' + asset, 'current_desc_' + asset]);

	const current_desc = registryVars['current_desc_' + asset];
	registryVars = Object.assign(registryVars, await getStateVarsForPrefixes(conf.token_registry_aa_address, ['decimals_' + current_desc]));

	assocDepositsAas[depositsAaAddress] = {
		asset,
		asset_symbol: registryVars['a2s_' + asset],
		asset_decimals: registryVars['decimals_' + current_desc],
		curveAaAddress
	}
	assocDepositsAasByCurves[curveAaAddress] = assocDepositsAas[depositsAaAddress];
}


function discoverCurveAas(){
	return new Promise(function(resolve){
		network.requestFromLightVendor('light/get_aas_by_base_aas', {
			base_aa: conf.curve_base_aa
		}, async function(ws, request, arrResponse){
			await Promise.all(arrResponse.map(indexAndWatchCurveAa));
			resolve();
		});
	});
}



async function indexAndWatchGovernanceAa(governanceAaAddress, curveAaAddress){
	return new Promise(function(resolve){
		assocGovernanceAas[governanceAaAddress] = {
			asset: assocCurveAas[curveAaAddress].asset1,
			curveAaAddress
		}
		walletGeneral.addWatchedAddress(governanceAaAddress, resolve);
	});
}

async function indexAllCurveAaParams(objAa){
	const curveAaAddress = objAa.address;
	const reserve_asset = objAa.definition[1].params.reserve_asset;

	const curveAaVars = await getStateVars(curveAaAddress);
	var registryVars = await getStateVarsForPrefixes(conf.token_registry_aa_address, [
		'a2s_' + curveAaVars.asset1, 
		'a2s_' + curveAaVars.asset2, 
		'a2s_' + reserve_asset, 
		'current_desc_' + reserve_asset
	]);
	const current_desc = registryVars['current_desc_' + reserve_asset];
	registryVars = Object.assign(registryVars, await getStateVarsForPrefixes(conf.token_registry_aa_address, ['decimals_' + current_desc]));
	assocCurveAas[curveAaAddress] = {
		aa_address: curveAaAddress,
		governance_aa: curveAaVars.governance_aa,
		asset1: curveAaVars.asset1,
		asset2: curveAaVars.asset2,
		interest_rate: curveAaVars.interest_rate,
		asset1_decimals: objAa.definition[1].params.decimals1,
		asset2_decimals: objAa.definition[1].params.decimals2,
		asset1_symbol: registryVars['a2s_' + curveAaVars.asset1],
		asset2_symbol: registryVars['a2s_' + curveAaVars.asset2],
		reserve_asset,
		reserve_asset_decimals: reserve_asset == 'base' ? 9 : registryVars['decimals_' + current_desc],
		reserve_asset_symbol: reserve_asset == 'base' ? 'GB' : registryVars['a2s_' + reserve_asset],
		leverage: objAa.definition[1].params.leverage || 0
	}
	await indexAndWatchGovernanceAa(curveAaVars.governance_aa, curveAaAddress);
}

function handleJustsaying(ws, subject, body) {
	switch (subject) {
		case 'light/aa_definition':
			onAADefinition(body);
			break;

		case 'light/have_updates':
			lightWallet.refreshLightClientHistory();
			break;
	}
}

eventBus.on("message_for_light", handleJustsaying);

function onAADefinition(objUnit){

	for (var i=0; i<objUnit.messages.length; i++){
		var message = objUnit.messages[i];
		var payload = message.payload;
		if (message.app === 'definition' && payload.definition[1].base_aa){
				const base_aa = payload.definition[1].base_aa;
				if (base_aa == conf.deposit_base_aa)
					indexAndWatchDepositsAa({ address: objectHash.getChash160(payload.definition), definition: payload.definition });
				if (base_aa == conf.curve_base_aa){
					const address = objectHash.getChash160(payload.definition);
					const definition = payload.definition;
					indexAndWatchCurveAa({ address, definition });
					announcements.announceNewCurve(address, definition);
				}
		}
	}
}




function getStateVarsForPrefixes(aa_address, arrPrefixes){
	return new Promise(function(resolve){
		Promise.all(arrPrefixes.map((prefix)=>{
			return getStateVarsForPrefix(aa_address, prefix)
		})).then((arrResults)=>{
			return resolve(Object.assign({}, ...arrResults));
		}).catch((error)=>{
			return resolve({});
		});
	});
}

function getStateVarsForPrefix(aa_address, prefix, start = '0', end = 'z', firstCall = true){
	return new Promise(function(resolve, reject){
		if (firstCall)
			prefix = prefix.slice(0, -1);
		const CHUNK_SIZE = 2000; // server wouldn't accept higher chunk size

		if (start === end)
			return getStateVarsForPrefix(aa_address, prefix + start,  '0', 'z').then(resolve).catch(reject); // we append prefix to split further

		network.requestFromLightVendor('light/get_aa_state_vars', {
			address: aa_address,
			var_prefix_from: prefix + start,
			var_prefix_to: prefix + end,
			limit: CHUNK_SIZE
		}, function(ws, request, objResponse){
			if (objResponse.error)
				return reject(objResponse.error);

			if (Object.keys(objResponse).length >= CHUNK_SIZE){ // we reached the limit, let's split in two ranges and try again
				const delimiter =  Math.floor((end.charCodeAt(0) - start.charCodeAt(0)) / 2 + start.charCodeAt(0));
				Promise.all([
					getStateVarsForPrefix(aa_address, prefix, start, String.fromCharCode(delimiter), false),
					getStateVarsForPrefix(aa_address, prefix, String.fromCharCode(delimiter +1), end, false)
				]).then(function(results){
					return resolve({...results[0], ...results[1]});
				}).catch(function(error){
					return reject(error);
				})
			} else{
				return resolve(objResponse);
			}

		});
	});
}


function getStateVars(aa_address){
	return new Promise((resolve)=>{
		network.requestFromLightVendor('light/get_aa_state_vars', {
			address: aa_address
		}, function(ws, request, objResponse){
			if (objResponse.error){
				console.log("Error when requesting state vars for " + aa_address + ": " + objResponse.error);
				resolve({});
			} else
				resolve(objResponse);
		});
	});
}

function getJointFromStorageOrHub(unit){
	return new Promise(async (resolve) => {

		var joint = await storage.readUnit(unit);
		if (joint)
			return resolve(joint);
		const network = require('ocore/network.js');
		network.requestFromLightVendor('get_joint', unit,  function(ws, request, response){
			if (response.joint){
				resolve(response.joint.unit)
			} else {
				resolve();
			}
		});
	});
}



process.on('unhandledRejection', up => { throw up });