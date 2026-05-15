/*! supra-ts-sdk v1.0.0 | (c) 2026 Supra | MIT */

// src/utils/apiEndpoints.ts
var Network = /* @__PURE__ */ ((Network2) => {
  Network2["MAINNET"] = "mainnet";
  Network2["TESTNET"] = "testnet";
  Network2["CUSTOM"] = "custom";
  return Network2;
})(Network || {});
var NetworkInfo = {
  ["mainnet" /* MAINNET */]: {
    name: "mainnet",
    chainId: 8,
    rpcUrl: "https://rpc-mainnet.supra.com"
  },
  ["testnet" /* TESTNET */]: {
    name: "testnet",
    chainId: 6,
    rpcUrl: "https://rpc-testnet.supra.com"
  },
  ["custom" /* CUSTOM */]: {
    name: "custom",
    chainId: 0,
    rpcUrl: ""
  }
};

// src/errors/apiError.ts
var SupraAPIError = class extends Error {
  status;
  statusText;
  url;
  data;
  major_status;
  constructor(args) {
    super(args.statusText);
    this.name = "SupraAPIError";
    this.status = args.status;
    this.statusText = args.statusText;
    this.url = args.url;
    this.data = args.data;
    const message = args.data?.message?.toString();
    const match = message?.match(/major_status: (\w+)/);
    this.major_status = match ? match[1] : "unknown";
  }
  toJSON() {
    return {
      name: this.name,
      status: this.status,
      statusText: this.statusText,
      url: this.url,
      data: this.data,
      major_status: this.major_status
    };
  }
};

// src/utils/constants.ts
var DEFAULT_CHAIN_ID = 6;
var MAX_RETRY_FOR_TRANSACTION_COMPLETION = 300;
var DELAY_BETWEEN_POOLING_REQUEST = 1e3;
var DEFAULT_RECORDS_ITEMS_COUNT = 15;
var DEFAULT_MAX_GAS_UNITS = BigInt(1e3);
var DEFAULT_GAS_PRICE = BigInt(1e5);
var DEFAULT_TX_EXPIRATION_DURATION = 300;
var MILLISECONDS_PER_SECOND = 1e3;
var SUPRA_FRAMEWORK_ADDRESS = "0x0000000000000000000000000000000000000000000000000000000000000001";
var SUPRA_COIN_TYPE = "0x1::supra_coin::SupraCoin";
var OBJECT_CORE = "0x1::object::ObjectCore";
var DEFAULT_ENABLE_SIMULATION = false;
var DEFAULT_WAIT_FOR_TX_COMPLETION = false;
var DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_EXISTS = 10;
var DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_NOT_EXISTS = 1020;
var RAW_TRANSACTION_SALT = "SUPRA::RawTransaction";
var RAW_TRANSACTION_WITH_DATA_SALT = "SUPRA::RawTransactionWithData";
var DEFAULT_RPC_VERSION = "v3";
var DEFAULT_TXN_TIMEOUT_SEC = 20;
var DEFAULT_REQUEST_TIMEOUT_MS = 3e4;

// src/client/get.ts
async function get(args, config, rpcVersion = DEFAULT_RPC_VERSION) {
  const baseURL = `${config.rpcUrl}/rpc/${rpcVersion}${args.path}`;
  const url = new URL(baseURL);
  if (args.query) {
    for (const [key, value] of Object.entries(args.query)) {
      if (value !== void 0) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json"
    },
    signal: AbortSignal.timeout(config.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS)
  });
  const data = await response.json();
  const cursor = response.headers.get("x-supra-cursor") ?? void 0;
  if (response.ok) {
    return {
      data,
      cursor
    };
  }
  throw new SupraAPIError({
    status: response.status,
    statusText: response.statusText,
    url: url.toString(),
    data
  });
}

// src/helper/account.ts
import { HexString } from "supra-l1-sdk-core";
function standardizeAddress(address) {
  let accountAddress = typeof address === "string" ? HexString.ensure(address).toString() : address.toString();
  let cleanAddress = accountAddress.replace(/^0x/, "");
  if (cleanAddress.length < 64) {
    cleanAddress = cleanAddress.padStart(64, "0");
  }
  if (cleanAddress.length > 64) {
    throw new SupraAPIError({
      url: "",
      status: 400,
      statusText: `Address ${address} is not a valid address`
    });
  }
  return `0x${cleanAddress}`;
}

// src/helper/general.ts
import { TxnBuilderTypes, TypeTagParser } from "supra-l1-sdk-core";
function getFunctionParts(functionArg) {
  const funcNameParts = functionArg.split("::");
  if (funcNameParts.length !== 3) {
    throw new Error(`Invalid function ${functionArg}`);
  }
  const moduleAddress = funcNameParts[0];
  const moduleName = funcNameParts[1];
  const functionName = funcNameParts[2];
  return { moduleAddress, moduleName, functionName };
}
function convertPayloadTypeArgsToJSONParsable(functionAbi, args) {
  if (!args.typeArguments || args.typeArguments.length == 0) return [];
  if (functionAbi.generic_type_params.length !== args.typeArguments.length) {
    throw new Error(`Function ${functionAbi.name} has ${functionAbi.generic_type_params.length} type arguments, but ${args.typeArguments.length} were provided`);
  }
  let typeArguments = args.typeArguments.map((_, idx) => {
    return convertTypeArgsValueToJSONParsable(args.typeArguments[idx]);
  });
  return typeArguments;
}
function convertPayloadTypeArgsToMoveType(functionAbi, args) {
  if (!args.typeArguments || args.typeArguments.length == 0) return [];
  if (functionAbi.generic_type_params.length !== args.typeArguments.length) {
    throw new Error(`Function ${functionAbi.name} has ${functionAbi.generic_type_params.length} type arguments, but ${args.typeArguments.length} were provided`);
  }
  let typeArguments = args.typeArguments.map((_, idx) => {
    return convertTypeArgsValueToMoveTypeValue(args.typeArguments[idx]);
  });
  return typeArguments;
}
function convertPayloadArgsToJSONParsable(functionAbi, args) {
  if (!args.functionArguments || args.functionArguments.length === 0) return [];
  if (functionAbi.params.length !== args.functionArguments.length) {
    throw new Error(`Function ${functionAbi.name} has ${functionAbi.params.length} arguments, but ${args.functionArguments.length} were provided`);
  }
  return functionAbi.params.map((typeStr, idx) => {
    return convertArgsValueToJSONParsable(typeStr, args.functionArguments[idx]);
  });
}
function convertTypeArgsValueToJSONParsable(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof TxnBuilderTypes.TypeTag) {
    const typeTagStruct = value;
    return `${typeTagStruct.value.address.toHexString()}::${typeTagStruct.value.module_name.value}::${typeTagStruct.value.name.value}`;
  }
  throw new Error(`Invalid type argument: ${value}`);
}
function convertTypeArgsValueToMoveTypeValue(value) {
  if (typeof value === "string") {
    return new TypeTagParser(value).parseTypeTag();
  }
  if (value instanceof TxnBuilderTypes.TypeTag) {
    return value;
  }
  throw new Error(`Invalid type argument: ${value}`);
}
function convertArgsValueToJSONParsable(type, value) {
  if (value === null || value === void 0) {
    const optionInner2 = extractOptionInner(type);
    if (optionInner2) {
      if (optionInner2 === "u8") return { vec: "" };
      if (optionInner2 === "vector<u8>") return { vec: [] };
      return { vec: [] };
    }
    return null;
  }
  const intTypes = ["u8", "u16", "u32", "i8", "i16", "i32"];
  const bigIntTypes = ["u64", "u128", "u256", "i64", "i128", "i256"];
  const optionInner = extractOptionInner(type);
  if (optionInner) {
    if (optionInner === "u8") {
      return { vec: String(value) };
    }
    if (optionInner === "vector<u8>") {
      if (typeof value === "string") return { vec: [value] };
      if (value instanceof Uint8Array) return { vec: [uint8ArrayToHexString(value)] };
      if (value instanceof ArrayBuffer) return { vec: [uint8ArrayToHexString(new Uint8Array(value))] };
      if (Array.isArray(value)) {
        const hex = value.map((v) => Number(v).toString(16).padStart(2, "0")).join("");
        return { vec: [hex] };
      }
      throw new Error("Invalid Option<vector<u8>> value");
    }
    return { vec: [convertArgsValueToJSONParsable(optionInner, value)] };
  }
  if (type === "vector<u8>") {
    if (typeof value === "string") {
      return value;
    }
    if (value instanceof Uint8Array) return uint8ArrayToHexString(value);
    if (value instanceof ArrayBuffer) return uint8ArrayToHexString(new Uint8Array(value));
    if (Array.isArray(value)) {
      return value.map((v) => {
        const n = Number(v);
        if (n < 0 || n > 255) throw new Error("Invalid u8 value in vector<u8>");
        return n.toString(16).padStart(2, "0");
      }).join("");
    }
    throw new Error("Invalid vector<u8> input");
  }
  const vectorInner = extractVectorInner(type);
  if (vectorInner) {
    if (!Array.isArray(value)) {
      throw new Error(`Expected array for type '${type}'`);
    }
    return value.map(
      (v) => convertArgsValueToJSONParsable(vectorInner, v)
    );
  }
  if (intTypes.includes(type)) return Number(value);
  if (bigIntTypes.includes(type)) return value.toString();
  if (type === "bool") return Boolean(value);
  if (type === "address") return String(value);
  if (isMoveStruct(type)) {
    return value;
  }
  return value;
}
function convertValueToAbiReturnTypedValue(returnType, response) {
  if (!returnType || returnType.length === 0) return [];
  return returnType.map(
    (typeStr, idx) => convertValueToReturnTypedValue(typeStr, response[idx])
  );
}
function convertValueToReturnTypedValue(type, value) {
  const intTypes = ["u8", "u16", "u32", "i8", "i16", "i32"];
  const bigIntTypes = ["u64", "u128", "u256", "i64", "i128", "i256"];
  if (type.startsWith("0x1::object::Object")) {
    if (typeof value == "object" && value !== null && "inner" in value) {
      return value.inner;
    }
  }
  const optionInner = extractOptionInner(type);
  if (optionInner) {
    const optVal = value;
    if (optionInner === "u8") return optVal.vec;
    if (!optVal.vec || optVal.vec.length === 0) return null;
    return convertValueToReturnTypedValue(optionInner, optVal.vec[0]);
  }
  if (type === "vector<u8>") {
    if (typeof value === "string") {
      return value;
    }
    return value;
  }
  const vectorInner = extractVectorInner(type);
  if (vectorInner) {
    if (!Array.isArray(value)) {
      throw new Error(`Expected array for ${type}`);
    }
    return value.map(
      (v) => convertValueToReturnTypedValue(vectorInner, v)
    );
  }
  if (intTypes.includes(type)) return Number(value);
  if (bigIntTypes.includes(type)) return BigInt(value);
  if (type === "bool") return Boolean(value);
  if (type === "address") return String(value);
  if (isMoveStruct(type)) return value;
  return value;
}
function extractOptionInner(type) {
  const match = type.match(/^0x[0-9a-fA-F]+::option::Option<(.*)>$/);
  return match ? match[1] : null;
}
function extractVectorInner(type) {
  const match = type.match(/^vector<(.*)>$/);
  return match ? match[1] : null;
}
function isMoveStruct(type) {
  return /^0x[0-9a-fA-F]+::[0-9a-zA-Z_]+::[0-9a-zA-Z_]+$/.test(type);
}
function uint8ArrayToHexString(bytes) {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function addAddressPadding(address) {
  if (!address) return address;
  const isLpTokenAddressMatch = address.match(/<([^>]+)>/);
  if (isLpTokenAddressMatch && isLpTokenAddressMatch.length === 2) {
    const firstPart = address.slice(0, address.indexOf("<"));
    if (firstPart.includes("::")) {
      const inner = isLpTokenAddressMatch[1] ?? "";
      if (inner) {
        const innerFixed = inner.split(",").map((part) => addAddressPadding(part.trim())).join(", ");
        return `${addAddressPadding(firstPart)}<${innerFixed}>`;
      }
    }
  }
  address = address.trim().replace(/^Ox/, "0x").replace(/^0X/, "0x");
  if (address.includes("::")) {
    const [addrPart, ...rest] = address.split("::");
    const paddedAddr = addAddressPadding(addrPart);
    return `${paddedAddr}::${rest.join("::")}`;
  }
  if (!address.startsWith("0x")) {
    address = "0x" + address;
  }
  const hexPart = address.slice(2);
  const paddedHex = hexPart.padStart(64, "0");
  return "0x" + paddedHex;
}

// src/client/post.ts
async function post(args, config, rpcVersion = DEFAULT_RPC_VERSION) {
  const url = `${config.rpcUrl}/rpc/${rpcVersion}${args.path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: args.data ? JSON.stringify(args.data) : null,
    signal: AbortSignal.timeout(config.timeout ?? DEFAULT_REQUEST_TIMEOUT_MS)
  });
  const data = await response.json();
  if (response.ok) {
    return data;
  }
  throw new SupraAPIError({
    status: response.status,
    statusText: response.statusText,
    url,
    data
  });
}

// src/helper/abi.ts
async function getFunctionABI(abi, moduleAddress, moduleName, functionName) {
  const funcABI = abi.exposed_functions.find(
    (f) => f.name === functionName
  );
  if (!funcABI) {
    throw new Error(
      `Function '${functionName}' not found in module '${moduleAddress}::${moduleName}'`
    );
  }
  return funcABI;
}

// src/helper/view.ts
async function generateViewFunctionPayload(args, config) {
  let { moduleAddress, moduleName, functionName } = getFunctionParts(args.function);
  if (!args.abi) {
    args.abi = (await getAccountModuleInternal({ accountAddress: moduleAddress, moduleName }, config)).abi;
  }
  let funcABI = await getFunctionABI(args.abi, moduleAddress, moduleName, functionName);
  let parsableTypeArguments = convertPayloadTypeArgsToJSONParsable(funcABI, args);
  let parsableArguments = convertPayloadArgsToJSONParsable(funcABI, args);
  return {
    function: args.function,
    typeArguments: parsableTypeArguments ?? [],
    functionArguments: parsableArguments,
    returnType: funcABI.return
  };
}

// src/internal/methods.ts
async function viewInternal(args, config) {
  let { functionArguments, typeArguments, returnType } = await generateViewFunctionPayload(args, config);
  let rawResponse = await post({
    path: `/view`,
    data: {
      function: args.function,
      type_arguments: typeArguments ?? [],
      arguments: functionArguments ?? []
    }
  }, config).then((res) => res.result);
  return convertValueToAbiReturnTypedValue(returnType, rawResponse);
}
async function viewRawInternal(args, config) {
  return await post({
    path: `/view`,
    data: {
      function: args.function,
      type_arguments: args.typeArguments ?? [],
      arguments: args.functionArguments ?? []
    }
  }, config).then((res) => res.result);
}

// src/internal/account.ts
function getAccountLegacyCoins(resources) {
  return resources.filter((resource) => resource.type.startsWith("0x1::coin::CoinStore<")).reduce((acc, resource) => {
    const data = resource.data;
    acc[resource.type] = data.coin.value;
    return acc;
  }, {});
}
async function getAccountInfoInternal(args, config) {
  return (await get({
    path: `/accounts/${standardizeAddress(args.accountAddress)}`
  }, config)).data;
}
async function getAccountModulesInternal(args, config) {
  let { data, cursor } = await get({
    path: `/accounts/${standardizeAddress(args.accountAddress)}/modules`,
    query: {
      count: args.options?.count,
      start: args.options?.start
    }
  }, config);
  return { response: data, cursor };
}
async function getAccountModuleInternal(args, config) {
  return (await get({
    path: `/accounts/${standardizeAddress(args.accountAddress)}/modules/${args.moduleName}`
  }, config)).data;
}
async function getAccountResourcesInternal(args, config) {
  let { data, cursor } = await get({
    path: `/accounts/${standardizeAddress(args.accountAddress)}/resources`,
    query: {
      count: args.options?.count,
      start: args.options?.start
    }
  }, config);
  return { response: data, cursor };
}
async function getAccountResourceInternal(args, config) {
  return (await get({
    path: `/accounts/${standardizeAddress(args.accountAddress)}/resources/${args.resourceType}`
  }, config)).data;
}
async function getAccountTransactionsInternal(args, config) {
  let { data, cursor } = await get({
    path: `/accounts/${standardizeAddress(args.accountAddress)}/transactions`,
    query: {
      count: args.options?.count,
      start: args.options?.start,
      ascending: args.options?.ascending
    }
  }, config);
  return { response: data, cursor };
}
async function getAccountCoinTransactionsInternal(args, config) {
  let { data, cursor } = await get({
    path: `/accounts/${standardizeAddress(args.accountAddress)}/coin_transactions`,
    query: {
      count: args.options?.count,
      start: args.options?.start,
      ascending: args.options?.ascending,
      type: args.options?.type
    }
  }, config);
  return { response: data, cursor };
}
async function getAccountAutoTransactionsInternal(args, config) {
  let { data, cursor } = await get({
    path: `/accounts/${standardizeAddress(args.accountAddress)}/automated_transactions`,
    query: {
      count: args.options?.count,
      block_height: args.options?.block_height,
      cursor: args.options?.cursor,
      ascending: args.options?.ascending
    }
  }, config);
  return { response: data, cursor };
}
async function getAccountCoinsCountInternal(args, config) {
  let cursor = "";
  let legacyTokensCount = 0;
  while (cursor !== void 0) {
    let { response: resources, cursor: cursorInfo } = await getAccountResourcesInternal({ accountAddress: args.accountAddress, options: cursor ? { start: cursor } : {} }, config);
    let tokens = getAccountLegacyCoins(resources);
    if (cursorInfo != cursor) {
      cursor = cursorInfo;
    } else {
      cursor = void 0;
    }
    legacyTokensCount += Object.keys(tokens).length;
  }
  return legacyTokensCount;
}
async function getAccountCoinBalanceInternal(args, config) {
  if (isMoveStruct(args.asset.toString())) {
    return await viewInternal({
      function: "0x1::coin::balance",
      functionArguments: [args.accountAddress.toString()],
      typeArguments: [args.asset.toString()]
    }, config).then((res) => res[0]);
  } else {
    return await viewInternal({
      function: "0x1::primary_fungible_store::balance",
      functionArguments: [args.accountAddress.toString(), args.asset.toString()],
      typeArguments: [OBJECT_CORE]
    }, config).then((res) => res[0]);
  }
}
async function isAccountExistsInternal(args, config) {
  try {
    await getAccountInfoInternal({ accountAddress: args.accountAddress }, config);
    return true;
  } catch {
    return false;
  }
}

// src/helper/validation.ts
var HEX_ADDRESS_REGEX = /^0x[0-9a-fA-F]{1,64}$/;
function validateAddress(address, paramName = "address") {
  const str = typeof address === "string" ? address : address != null && typeof address.toString === "function" ? String(address) : void 0;
  if (!str || !HEX_ADDRESS_REGEX.test(str)) {
    throw new Error(
      `Invalid ${paramName}: expected a 0x-prefixed hex string (1-64 hex chars), got ${JSON.stringify(String(address))}`
    );
  }
}
function validateStructId(structId, paramName = "resourceType") {
  if (typeof structId !== "string") {
    throw new Error(`Invalid ${paramName}: expected a string, got ${typeof structId}`);
  }
  const baseType = structId.includes("<") ? structId.slice(0, structId.indexOf("<")) : structId;
  const parts = baseType.split("::");
  if (parts.length !== 3) {
    throw new Error(
      `Invalid ${paramName}: expected format "0xADDR::module::StructName", got "${structId}"`
    );
  }
  validateAddress(parts[0], `${paramName} module address`);
}
function validateTransactionHash(hash, paramName = "transactionHash") {
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]+$/.test(hash)) {
    throw new Error(
      `Invalid ${paramName}: expected a 0x-prefixed hex string, got ${JSON.stringify(hash)}`
    );
  }
}
function validatePaginationCount(count, paramName = "count") {
  if (count === void 0 || count === null) return;
  if (typeof count !== "number" || !Number.isInteger(count) || count < 1 || count > 100) {
    throw new Error(
      `Invalid ${paramName}: expected an integer between 1 and 100, got ${JSON.stringify(count)}`
    );
  }
}

// src/api/account.ts
var Account = class {
  /**
   * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
   */
  networkInformation;
  /**
   * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
   * @param networkInformation - A NetworkConfig object that contains information about the network on which the SupraClient is running.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * ```  
   * @group Account
   */
  constructor(networkInformation) {
    this.networkInformation = networkInformation;
  }
  /**
   * Check whether given account exists onchain or not
   * @param args.accountAddress - The address of the account to query.
   * @returns `true` if account exists otherwise `false`
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const accountAddress = "0x1"; 
   *    const isAccountExists = await supra.account.isAccountExists({ account: accountAddress});
   *    console.log(isAccountExists);
   * }
   * 
   * runExample().catch(console.error);
   * ```
   * @group Account
   */
  async isAccountExists(args) {
    validateAddress(args.accountAddress, "accountAddress");
    return isAccountExistsInternal(args, this.networkInformation);
  }
  /**
   * Queries the current state of an account, including its sequence number and authentication key.
   * @param args.accountAddress - The address of the account to query.
   * @returns A Promise that resolves to an AccountData object containing the sequence number and authentication key of the account.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const accountAddress = "0x1"; 
   *    const accountData = await supra.account.getAccountInfo({ accountAddress: accountAddress}); });
   *   console.log(accountData);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group Account
   */
  async getAccountInfo(args) {
    validateAddress(args.accountAddress, "accountAddress");
    return getAccountInfoInternal(args, this.networkInformation);
  }
  /**
   * Queries the modules of an account.
   * @param args.accountAddress - The address of the account to query.
   * @param args.options.count - The number of modules to return.
   * @param args.options.start - Cursor specifying where to start for pagination. Use the cursor returned by the previous request when making the next request.
   * @returns A Promise that resolves to an array of MoveModuleBytecode objects representing the modules of the account with optional cursor.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const accountAddress = "0x1";
   *    const {response: accountModules, cursor} = await supra.account.getAccountModules({ accountAddress: accountAddress });
   *    console.log(accountModules);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group Account
   */
  async getAccountModules(args) {
    validateAddress(args.accountAddress, "accountAddress");
    validatePaginationCount(args.options?.count);
    return getAccountModulesInternal(args, this.networkInformation);
  }
  /**
   * Queries a specific module of an account.
   * @param args.accountAddress - The address of the account to query.
   * @param args.moduleName - The name of the module to query.
   * @returns A Promise that resolves to a MoveModuleBytecode object representing the module of the account.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const accountAddress = "0x1";
   *    const accountModule = await supra.account.getAccountModule({ accountAddress: accountAddress, moduleName: "module_name" });
   *    console.log(accountModule);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group Account  
   */
  async getAccountModule(args) {
    validateAddress(args.accountAddress, "accountAddress");
    return getAccountModuleInternal(args, this.networkInformation);
  }
  /**
   * Queries the resources of an account.
   * @param args.accountAddress - The address of the account to query.
   * @param args.options.count - The number of resources to return.
   * @param args.options.start - Cursor specifying where to start for pagination. Use the cursor returned by the previous request when making the next request.
   * @returns A Promise that resolves to an array of MoveResource objects representing the resources of the account with optional cursor.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const accountAddress = "0x1";
   *    const {response: accountResources, cursor} = await supra.account.getAccountResources({ accountAddress: accountAddress });
   *    console.log(accountResources);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group Account
   */
  async getAccountResources(args) {
    validateAddress(args.accountAddress, "accountAddress");
    validatePaginationCount(args.options?.count);
    return getAccountResourcesInternal(args, this.networkInformation);
  }
  /**
   * Queries a specific resource of an account.
   * @template T - The type of the resource to be returned.
   * @param args.accountAddress - The address of the account to query.
   * @param args.resourceType - The type of the resource to query.
   * @returns A Promise that resolves to a MoveResource object representing the resource of the account.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const accountAddress = "0x1";
   *    const accountResource = await supra.account.getAccountResource({ accountAddress: accountAddress, resourceType: "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>" });
   *    console.log(accountResource);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group Account
   */
  async getAccountResource(args) {
    validateAddress(args.accountAddress, "accountAddress");
    validateStructId(args.resourceType, "resourceType");
    return getAccountResourceInternal(args, this.networkInformation);
  }
  /**
   * Queries the transactions of an account.
   * @template {TransactionResponse} T - The type of the transaction to be returned.
   * @param args.accountAddress - The address of the account to query.
   * @param args.options.count - The number of transactions to return.
   * @param args.options.start - Cursor specifying where to start for pagination. Use the cursor returned by the previous request when making the next request.
   * @param args.options.ascending - Whether to return the transactions in ascending order.   
   * @note Maximum number of items to return default is 20 and maximum is 100.
   * @returns A Promise that resolves to an array of TransactionResponse objects representing the transactions of the account with optional cursor.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const accountAddress = "0x1";
   *    const {response: accountTransactions, cursor} = await supra.account.getAccountTransactions({ accountAddress: accountAddress });
   *    console.log(accountTransactions);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group Account
   */
  async getAccountTransactions(args) {
    validateAddress(args.accountAddress, "accountAddress");
    validatePaginationCount(args.options?.count);
    return getAccountTransactionsInternal(args, this.networkInformation);
  }
  /**
   * Queries the coin transactions of an account.
   * @template {TransactionResponse} T - The type of the transaction to be returned.
   * @param args.accountAddress - The address of the account to query.
   * @param args.options.count - The number of transactions to return.
   * @param args.options.start - Cursor specifying where to start for pagination. Use the cursor returned by the previous request when making the next request.
   * @param args.options.ascending - Whether to return the transactions in ascending order.
   * @note Maximum number of items to return default is 20 and maximum is 100.
   * @returns A Promise that resolves to an array of TransactionResponse objects representing the coin transactions of the account with optional cursor.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const accountAddress = "0x1";
   *    const {response: accountCoinTransactions , cursor} = await supra.account.getAccountCoinTransactions({ accountAddress: accountAddress });
   *    console.log(accountCoinTransactions);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group Account
   */
  async getAccountCoinTransactions(args) {
    validateAddress(args.accountAddress, "accountAddress");
    validatePaginationCount(args.options?.count);
    return getAccountCoinTransactionsInternal(args, this.networkInformation);
  }
  /**
   * Queries the auto transactions of an account.
   * @template {TransactionResponse} T - The type of the transaction to be returned.
   * @param args.accountAddress - The address of the account to query.
   * @param args.options.count - The number of transactions to return.
   * @param args.options.block_height - Starting block height (inclusive). Optional.
   *  The block height at which to start lookup for transactions. If provided, returns :count of transactions starting from it in the specified order. For order see :ascending flag.
   * @note If a :cursor is specified then this field will be ignored. 
   * @param args.options.cursor - Cursor specifying where to start for pagination. Use the cursor returned by the previous request when making the next request.
   * If provided, returns :count of transactions starting from this cursor in the specified order. For order see :ascending flag.
   * If not specified, the lookup will be done based on the :block_height parameter value. 
   * @note If both :cursor and :block_height are specified then :cursor has precedence.
   * @param args.options.ascending - Whether to return the transactions in ascending order.
   * @note Maximum number of items to return default is 20 and maximum is 100.
   * @returns A Promise that resolves to an array of AutoTransactionResponse objects representing the auto transactions of the account with optional cursor.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const accountAddress = "0x1";
   *    const {response: accountAutoTransactions, cursor} = await supra.account.getAccountAutoTransactions({ accountAddress: accountAddress });
   *    console.log(accountAutoTransactions);
   * }
   * 
   * runExample().catch(console.error);
   * ```
   * @group Account
   */
  async getAccountAutoTransactions(args) {
    validateAddress(args.accountAddress, "accountAddress");
    validatePaginationCount(args.options?.count);
    return getAccountAutoTransactionsInternal(args, this.networkInformation);
  }
  /**
   * Queries the number of coins owned by an account.
   * @param args.accountAddress - The address of the account to query.
   * @note This method is only available for legacy coins for now.
   * @returns A Promise that resolves to the number of coins owned by the account.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const accountAddress = "0x1";
   *    const accountCoinsCount = await supra.account.getAccountCoinsCount({ accountAddress: accountAddress });
   *    console.log(accountCoinsCount);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group Account
   */
  async getAccountCoinsCount(args) {
    validateAddress(args.accountAddress, "accountAddress");
    return getAccountCoinsCountInternal(args, this.networkInformation);
  }
  /**
   * Queries the balance of SupraCoin owned by an account.
   * @param args.accountAddress - The address of the account to query.
   * @returns A Promise that resolves to the balance of SupraCoin owned by the account.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const accountAddress = "0x1";
   *    const accountSupraCoinBalance = await supra.account.getAccountSupraCoinBalance({ accountAddress: accountAddress });
   *    console.log(accountSupraCoinBalance);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group Account
   */
  async getAccountSupraCoinBalance(args) {
    return this.getAccountCoinBalance({ accountAddress: args.accountAddress, asset: SUPRA_COIN_TYPE });
  }
  /**
   * Queries the balance of a coin owned by an account.
   * @param args.accountAddress - The address of the account to query.
   * @param args.asset - The address of the coin to query wether it is a legacy coin or fungible asset.
   * @returns A Promise that resolves to the balance of the coin owned by the account.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const accountAddress = "0x1";
   *    const accountSupraCoinBalance = await supra.account.getAccountCoinBalance({ accountAddress: accountAddress, asset: "0x1::supra_coin::SupraCoin" });
   *    console.log(accountSupraCoinBalance);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group Account
   */
  async getAccountCoinBalance(args) {
    validateAddress(args.accountAddress, "accountAddress");
    return getAccountCoinBalanceInternal(args, this.networkInformation);
  }
};

// src/internal/block.ts
async function getLatestBlockInternal(config) {
  return await get({
    path: `/block`
  }, config).then((res) => res.data);
}
async function getBlockByHeightInternal(args, config) {
  return await get({
    path: `/block/height/${args.height}`,
    query: {
      with_finalized_transactions: args.options?.withFinalizedTransactions,
      type: args.options?.type
    }
  }, config).then((res) => res.data);
}
async function getBlockByHashInternal(args, config) {
  return await get({
    path: `/block/${args.blockHash}`
  }, config).then((res) => res.data);
}
async function getTransactionsByBlockHashInternal(args, config) {
  return await get({
    path: `/block/${args.blockHash}/transactions`,
    query: {
      type: args.options?.type
    }
  }, config).then((res) => res.data);
}

// src/api/block.ts
var Block = class {
  /**
  * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
  */
  networkInformation;
  /**
  * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
  * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
  * @example
  * ```typescript
  * import { SupraClient,Network } from "supra-ts-sdk";
  * 
  * const supra = new SupraClient({ network: Network.TESTNET });
  * ```  
  * @group Block
  */
  constructor(networkInformation) {
    this.networkInformation = networkInformation;
  }
  /**
   * Get the meta information of the most recently finalized and executed block.
   * @returns A Promise that resolves to a FinalizedBlockHeader object.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   *
   * const supra = new SupraClient({ network: Network.TESTNET });
   *
   * async function runExample() {
   *    const block = await supra.block.getLatestBlock();
   *    console.log(block);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group Block
   */
  async getLatestBlock() {
    return getLatestBlockInternal(this.networkInformation);
  }
  /**
   * Get information about the block that has been finalized at the given height.
   * @param args.height - The height of the block to retrieve.
   * @param args.options.withFinalizedTransactions - Whether to include the transactions in the block.
   * @param args.options.type - The type of block to retrieve.
   * @returns A Promise that resolves to a FinalizedBlockHeader object.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const height = 1;
   *    const block = await supra.block.getBlockByHeight({ height: height });
   *    console.log(block);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group Block
   */
  async getBlockByHeight(args) {
    return getBlockByHeightInternal(args, this.networkInformation);
  }
  /**
   * Get the header and execution output statistics of the block with the given hash.
   * @param args.blockHash - The hash of the block to retrieve.
   * @returns A Promise that resolves to a FinalizedBlockHeader object.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const blockHash = "0x1";
   *    const block = await supra.block.getBlockByHash({ blockHash: blockHash });
   *    console.log(block);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group Block
   */
  async getBlockByHash(args) {
    return getBlockByHashInternal(args, this.networkInformation);
  }
  /**
   * Get a list containing the hashes of the transactions that were finalized in the block with the given hash in the order that they were executed.
   * @param args.blockHash - The hash of the block to retrieve.
   * @param args.options.type - The type of block to retrieve.
   * @returns A Promise that resolves to a string array.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const blockHash = "0x1";
   *    const transactions = await supra.block.getTransactionsByBlockHash({ blockHash: blockHash });
   *    console.log(transactions);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group Block
   */
  async getTransactionsByBlockHash(args) {
    return getTransactionsByBlockHashInternal(args, this.networkInformation);
  }
};

// src/internal/coin.ts
import { BCS as BCS7, HexString as HexString6, TypeTagParser as TypeTagParser2 } from "supra-l1-sdk-core";

// src/internal/transactionManager/txnBuild.ts
import { BCS as BCS6, HexString as HexString5, SupraAccount as SupraAccount2, TxnBuilderTypes as TxnBuilderTypes6 } from "supra-l1-sdk-core";

// src/internal/transaction.ts
import { BCS as BCS4, TxnBuilderTypes as TxnBuilderTypes5 } from "supra-l1-sdk-core";

// src/types/transaction.ts
var TransactionType = /* @__PURE__ */ ((TransactionType2) => {
  TransactionType2["User"] = "user";
  TransactionType2["Auto"] = "automated";
  TransactionType2["BlockMetadata"] = "block_metadata";
  TransactionType2["AutomationRecord"] = "automation_record";
  return TransactionType2;
})(TransactionType || {});
var TransactionStatus = /* @__PURE__ */ ((TransactionStatus2) => {
  TransactionStatus2["Success"] = "Success";
  TransactionStatus2["Fail"] = "Fail";
  TransactionStatus2["Invalid"] = "Invalid";
  TransactionStatus2["PendingAfterExecution"] = "PendingAfterExecution";
  TransactionStatus2["Pending"] = "Pending";
  return TransactionStatus2;
})(TransactionStatus || {});

// src/utils/functions.ts
import { BCS, TxnBuilderTypes as TxnBuilderTypes2 } from "supra-l1-sdk-core";
async function sleep(timeMs) {
  return new Promise((resolve) => {
    setTimeout(resolve, timeMs);
  });
}
var parseFunctionTypeArgs = (functionTypeArgs) => {
  const functionTypeArgsParsed = [];
  functionTypeArgs.forEach((data) => {
    const structTagData = data.value;
    functionTypeArgsParsed.push({
      struct: {
        address: structTagData.address.toHexString().toString(),
        module: structTagData.module_name.value,
        name: structTagData.name.value,
        type_args: parseFunctionTypeArgs(structTagData.type_args)
      }
    });
  });
  return functionTypeArgsParsed;
};
var parseScriptArgs = (scriptArgs) => {
  const parsedArgs = [];
  scriptArgs.forEach((arg) => {
    if (arg instanceof TxnBuilderTypes2.TransactionArgumentU8) {
      parsedArgs.push({ U8: arg.value });
    } else if (arg instanceof TxnBuilderTypes2.TransactionArgumentU32) {
      parsedArgs.push({ U32: arg.value });
    } else if (arg instanceof TxnBuilderTypes2.TransactionArgumentU64) {
      parsedArgs.push({ U64: Number(arg.value) });
    } else if (arg instanceof TxnBuilderTypes2.TransactionArgumentU128) {
      parsedArgs.push({ U128: Number(arg.value) });
    } else if (arg instanceof TxnBuilderTypes2.TransactionArgumentU256) {
      parsedArgs.push({ U256: Array.from(BCS.bcsSerializeU256(arg.value)) });
    } else if (arg instanceof TxnBuilderTypes2.TransactionArgumentAddress) {
      parsedArgs.push({ Address: arg.value.toHexString().toString() });
    } else if (arg instanceof TxnBuilderTypes2.TransactionArgumentU8Vector) {
      parsedArgs.push({ U8Vector: Array.from(arg.value) });
    } else if (arg instanceof TxnBuilderTypes2.TransactionArgumentBool) {
      parsedArgs.push({ Bool: arg.value });
    } else {
      throw new Error("Invalid script argument variant");
    }
  });
  return parsedArgs;
};
var fromUint8ArrayToJSArray = (arr) => {
  const resData = [];
  for (let i = 0; i < arr.length; i++) {
    if (arr[i]) {
      resData.push(Array.from(arr[i]));
    }
  }
  return resData;
};

// src/internal/transactionManager/txnSubmit.ts
import { BCS as BCS3, TxnBuilderTypes as TxnBuilderTypes4 } from "supra-l1-sdk-core";

// src/internal/transactionManager/txnSimulate.ts
import { BCS as BCS2, TxnBuilderTypes as TxnBuilderTypes3 } from "supra-l1-sdk-core";
async function simulateTxnInternal(args, config) {
  let txAuthenticatorWithValidSignatures = args.sendTxPayload.Move.authenticator;
  let txAuthenticatorClone = JSON.parse(JSON.stringify(txAuthenticatorWithValidSignatures));
  args.sendTxPayload.Move.authenticator = txAuthenticatorClone;
  unsetAuthenticatorSignatures(args.sendTxPayload.Move.authenticator);
  let simulatedTxnResponse = await post({
    path: "/transactions/simulate",
    data: args.sendTxPayload
  }, config);
  args.sendTxPayload.Move.authenticator = txAuthenticatorWithValidSignatures;
  if (simulatedTxnResponse.status == "Fail" /* Fail */) {
    throw new SupraAPIError({
      status: 400,
      statusText: simulatedTxnResponse.output.Move.vm_status,
      url: "",
      data: simulatedTxnResponse
    });
  }
  return simulatedTxnResponse;
}
function unsetAuthenticatorSignatures(txAuthenticator) {
  let nullSignature = "0x" + "0".repeat(128);
  if ("Ed25519" in txAuthenticator) {
    txAuthenticator.Ed25519.signature = nullSignature;
  } else if ("FeePayer" in txAuthenticator) {
    txAuthenticator.FeePayer.sender.Ed25519.signature = nullSignature;
    txAuthenticator.FeePayer.fee_payer_signer.Ed25519.signature = nullSignature;
    txAuthenticator.FeePayer.secondary_signers.forEach(
      (ed25519Authenticator) => {
        ed25519Authenticator.Ed25519.signature = nullSignature;
      }
    );
  } else {
    txAuthenticator.MultiAgent.sender.Ed25519.signature = nullSignature;
    txAuthenticator.MultiAgent.secondary_signers.forEach(
      (ed25519Authenticator) => {
        ed25519Authenticator.Ed25519.signature = nullSignature;
      }
    );
  }
}
async function simulateSerializedTxnInternal(args, config) {
  let sendTxPayload = {
    Move: {
      raw_txn: getRawTxnJSONInternal(
        TxnBuilderTypes3.RawTransaction.deserialize(
          new BCS2.Deserializer(args.serializedRawTransaction)
        )
      ),
      authenticator: args.txAuthenticator
    }
  };
  return await simulateTxnInternal({ sendTxPayload }, config);
}

// src/internal/transactionManager/txnSubmit.ts
async function submitTxnInternal(args, config) {
  if ((args.enableTransactionWaitAndSimulationArgs?.enableTransactionSimulation ?? DEFAULT_ENABLE_SIMULATION) === true) {
    console.log("Simulating transaction...");
    await simulateTxnInternal({ sendTxPayload: args.sendTxJsonPayload }, config);
  }
  console.log("Submitting transaction...");
  let txHash = await post({
    path: "/transactions/submit",
    data: args.sendTxJsonPayload
  }, config).then((res) => res);
  if (!args.enableTransactionWaitAndSimulationArgs?.enableWaitForTransaction) {
    return await getTransactionByHashInternal({ transactionHash: txHash, exclude_uncommitted: false }, config);
  }
  return await waitForTransactionInternal({
    transactionHash: txHash,
    options: {
      timeoutSecs: DEFAULT_TXN_TIMEOUT_SEC,
      checkSuccess: false
    }
  }, config);
}
async function submitSerializedRawTransactionInternal(args, config) {
  let sendTxPayload = sendTxnPayloadInternal(
    {
      senderAccount: args.senderAccount,
      rawTxn: TxnBuilderTypes4.RawTransaction.deserialize(
        new BCS3.Deserializer(args.serializedRawTransaction)
      )
    }
  );
  return await submitTxnInternal(
    {
      sendTxJsonPayload: sendTxPayload,
      enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {}
    },
    config
  );
}
async function submitSerializedRawTransactionAndSignatureInternal(args, config) {
  let sendTxPayload = {
    Move: {
      raw_txn: getRawTxnJSONInternal(
        TxnBuilderTypes4.RawTransaction.deserialize(
          new BCS3.Deserializer(args.serializedRawTransaction)
        )
      ),
      authenticator: {
        Ed25519: {
          public_key: args.senderPubkey.toString(),
          signature: args.signature.toString()
        }
      }
    }
  };
  return await submitTxnInternal(
    {
      sendTxJsonPayload: sendTxPayload,
      enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {}
    },
    config
  );
}
async function submitSponsorTransactionInternal(args, config) {
  let secondarySignersAuthenticatorJSON = [];
  args.secondarySignersAuthenticator.forEach((authenticator) => {
    secondarySignersAuthenticatorJSON.push(
      getED25519AuthenticatorJSON(authenticator)
    );
  });
  let sendTxPayload = {
    Move: {
      raw_txn: getRawTxnJSONInternal(args.rawTxn),
      authenticator: {
        FeePayer: {
          sender: getED25519AuthenticatorJSON(args.senderAuthenticator),
          secondary_signer_addresses: args.secondarySignersAccountAddress,
          secondary_signers: secondarySignersAuthenticatorJSON,
          fee_payer_address: args.feePayerAddress.toString(),
          fee_payer_signer: getED25519AuthenticatorJSON(args.feePayerAuthenticator)
        }
      }
    }
  };
  return await submitTxnInternal(
    {
      sendTxJsonPayload: sendTxPayload,
      enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {}
    },
    config
  );
}
async function submitMultiAgentTransactionInternal(args, config) {
  let secondarySignersAuthenticatorJSON = [];
  args.secondarySignersAuthenticator.forEach((authenticator) => {
    secondarySignersAuthenticatorJSON.push(
      getED25519AuthenticatorJSON(authenticator)
    );
  });
  let sendTxPayload = {
    Move: {
      raw_txn: getRawTxnJSONInternal(args.rawTxn),
      authenticator: {
        MultiAgent: {
          sender: getED25519AuthenticatorJSON(args.senderAuthenticator),
          secondary_signer_addresses: args.secondarySignersAccountAddress,
          secondary_signers: secondarySignersAuthenticatorJSON
        }
      }
    }
  };
  return await submitTxnInternal(
    {
      sendTxJsonPayload: sendTxPayload,
      enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {}
    },
    config
  );
}
function getED25519AuthenticatorJSON(authenticator) {
  return {
    Ed25519: {
      public_key: Buffer.from(authenticator.public_key.value).toString("hex"),
      signature: Buffer.from(authenticator.signature.value).toString("hex")
    }
  };
}

// src/internal/transaction.ts
import sha3 from "js-sha3";
async function getTransactionByHashInternal(args, config) {
  return await get({
    path: `/transactions/${standardizeAddress(args.transactionHash)}`,
    query: {
      type: args.type,
      exclude_uncommitted: args.exclude_uncommitted
    }
  }, config).then((res) => res.data);
}
async function isPendingTransactionInternal(args, config) {
  return (await getTransactionByHashInternal(args, config)).status === "Pending" /* Pending */;
}
async function waitForTransactionInternal(args, config) {
  const timeoutSecs = args.options?.timeoutSecs ?? DEFAULT_TXN_TIMEOUT_SEC;
  const checkSuccess = args.options?.checkSuccess ?? true;
  let isPending = true;
  let timeElapsed = 0;
  let lastTxn;
  let backoffIntervalMs = 200;
  const backoffMultiplier = 1.5;
  const maxBackoffMs = 5e3;
  while (isPending && timeElapsed < timeoutSecs) {
    let txn = await getTransactionByHashInternal({ transactionHash: args.transactionHash }, config);
    lastTxn = txn;
    isPending = txn.status === "Pending" /* Pending */;
    if (isPending) {
      await sleep(backoffIntervalMs);
      timeElapsed += backoffIntervalMs / 1e3;
      backoffIntervalMs = Math.min(backoffIntervalMs * backoffMultiplier, maxBackoffMs);
    }
  }
  if (isPending) {
    throw new SupraAPIError({
      status: 500,
      statusText: "Transaction timed out",
      url: `/transactions/${args.transactionHash}`,
      data: lastTxn
    });
  }
  if (!checkSuccess) {
    return lastTxn;
  }
  if (!lastTxn || lastTxn.status !== "Success" /* Success */) {
    throw new SupraAPIError({
      status: 500,
      statusText: "Transaction failed",
      url: `/transactions/${args.transactionHash}`,
      data: lastTxn
    });
  }
  return lastTxn;
}
function getTransactionSignatureMessageInternal(args) {
  let preHash = Uint8Array.from(
    Buffer.from(
      sha3.sha3_256(
        args.rawTxn instanceof TxnBuilderTypes5.RawTransaction ? RAW_TRANSACTION_SALT : RAW_TRANSACTION_WITH_DATA_SALT
      ),
      "hex"
    )
  );
  let rawTxSerializedData = new Uint8Array(BCS4.bcsToBytes(args.rawTxn));
  let signatureMessage = new Uint8Array(
    preHash.length + rawTxSerializedData.length
  );
  signatureMessage.set(preHash);
  signatureMessage.set(rawTxSerializedData, preHash.length);
  return signatureMessage;
}
function signTransactionInternal(args) {
  let signatureBuffer = args.senderAccount.signBuffer(getTransactionSignatureMessageInternal({ rawTxn: args.rawTxn }));
  if (args.rawTxn instanceof TxnBuilderTypes5.MultiAgentRawTransaction || args.rawTxn instanceof TxnBuilderTypes5.FeePayerRawTransaction) {
    const signerSignature = new TxnBuilderTypes5.Ed25519Signature(
      signatureBuffer.toUint8Array()
    );
    return new TxnBuilderTypes5.AccountAuthenticatorEd25519(
      new TxnBuilderTypes5.Ed25519PublicKey(args.senderAccount.signingKey.publicKey),
      signerSignature
    );
  }
  return signatureBuffer;
}
async function publishPackageInternal(args, config) {
  let codeSerializer = new BCS4.Serializer();
  let modulesTypeCode = [];
  args.modulesCode.map((module) => {
    modulesTypeCode.push(
      new TxnBuilderTypes5.Module(Uint8Array.from(module))
    );
  });
  BCS4.serializeVector(modulesTypeCode, codeSerializer);
  let sendTxPayload = sendTxnPayloadInternal({
    senderAccount: args.senderAccount,
    rawTxn: await rawTxnObjectInternal({
      senderAddress: args.senderAccount.address(),
      senderSequenceNumber: (await getAccountInfoInternal({ accountAddress: args.senderAccount.address() }, config)).sequence_number,
      function: `${SUPRA_FRAMEWORK_ADDRESS}::code::publish_package_txn`,
      functionTypeArgs: [],
      functionArgs: [BCS4.bcsSerializeBytes(args.packageMetadata), codeSerializer.getBytes()],
      optionalTransactionPayloadArgs: args.optionalTransactionArgs?.optionalTransactionPayloadArgs ?? {}
    }, config)
  });
  return await submitTxnInternal({
    sendTxJsonPayload: sendTxPayload,
    enableTransactionWaitAndSimulationArgs: args.optionalTransactionArgs?.enableTransactionWaitAndSimulationArgs ?? {}
  }, config);
}

// src/utils/serializer.ts
import { HexString as HexString4, BCS as BCS5 } from "supra-l1-sdk-core";
var DynamicTransactionSerializer = class {
  serializeValue(value, type, serializer) {
    if (type.startsWith("0x1::object::Object")) {
      if (typeof value !== "string") {
        throw new Error(`Expected string for Object, got ${typeof value}`);
      }
      return this.serializeAddress(value, serializer);
    }
    if (type.startsWith("0x1::option::Option<")) {
      if (value === null || value === void 0) {
        serializer.serializeU8(0);
      } else {
        serializer.serializeU8(1);
        const innerType = type.slice(19, -1);
        this.serializeValue(value, innerType, serializer);
      }
      return;
    }
    if (type.startsWith("vector<")) {
      const innerType = type.slice(7, -1);
      this.serializeVector(value, innerType, serializer);
      return;
    }
    switch (type) {
      case "address":
        this.serializeAddress(value, serializer);
        break;
      case "u8":
        this.serializeU8(value, serializer);
        break;
      case "u64":
        this.serializeU64(value, serializer);
        break;
      case "u128":
        this.serializeU128(value, serializer);
        break;
      case "bool":
        this.serializeBool(value, serializer);
        break;
      default:
        throw new Error(`Unsupported type: ${type}`);
    }
  }
  serializeVector(value, innerType, serializer) {
    if (!Array.isArray(value)) {
      throw new Error(
        `Expected array for vector<${innerType}>, got ${typeof value}`
      );
    }
    serializer.serializeU32AsUleb128(value.length);
    for (const item of value) {
      this.serializeValue(item, innerType, serializer);
    }
  }
  serializeAddress(value, serializer) {
    if (typeof value !== "string") {
      throw new Error(`Expected string for address, got ${typeof value}`);
    }
    let cleanAddress = value.replace(/^0x/, "");
    if (cleanAddress.length !== 64) {
      cleanAddress = cleanAddress.padStart(64, "0");
    }
    const addressBytes = new HexString4("0x" + cleanAddress).toUint8Array();
    if (addressBytes.length !== 32) {
      throw new Error("Invalid address length");
    }
    serializer.serializeFixedBytes(addressBytes);
  }
  serializeU8(value, serializer) {
    const num = typeof value === "string" ? parseInt(value, 10) : value;
    if (num < 0 || num > 255) {
      throw new Error(`u8 value out of range: ${num}`);
    }
    serializer.serializeU8(num);
  }
  serializeU64(value, serializer) {
    let num;
    if (typeof value === "string") {
      num = BigInt(value);
    } else if (typeof value === "number") {
      num = BigInt(value);
    } else {
      num = value;
    }
    if (num < 0) {
      throw new Error(`u64 value cannot be negative: ${num}`);
    }
    if (num <= BigInt(Number.MAX_SAFE_INTEGER)) {
      serializer.serializeU64(Number(num));
    } else {
      serializer.serializeU128(num);
    }
  }
  serializeU128(value, serializer) {
    let num;
    if (typeof value === "string") {
      num = BigInt(value);
    } else if (typeof value === "number") {
      num = BigInt(value);
    } else {
      num = value;
    }
    if (num < 0) {
      throw new Error(`u128 value cannot be negative: ${num}`);
    }
    serializer.serializeU128(num);
  }
  serializeBool(value, serializer) {
    if (typeof value !== "boolean") {
      throw new Error(`Expected boolean, got ${typeof value}`);
    }
    serializer.serializeBool(value);
  }
  prepareTransactionArgs(args, paramTypes) {
    if (args.length !== paramTypes.length) {
      throw new Error(
        `Argument count mismatch: expected ${paramTypes.length}, got ${args.length}`
      );
    }
    return args.map((arg, index) => {
      const serializer = new BCS5.Serializer();
      const paramType = paramTypes[index];
      try {
        this.serializeValue(arg, paramType, serializer);
        const bytes = serializer.getBytes();
        return bytes;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to serialize argument ${index} (${paramType}): ${errorMessage}`
        );
      }
    });
  }
};

// src/internal/transactionManager/txnBuild.ts
import sha32 from "js-sha3";
async function generateTransactionPayload(args, config) {
  let { moduleAddress, moduleName, functionName } = getFunctionParts(args.function);
  if (!args.abi) {
    args.abi = (await getAccountModuleInternal({ accountAddress: moduleAddress, moduleName }, config)).abi;
  }
  let funcABI = await getFunctionABI(args.abi, moduleAddress, moduleName, functionName);
  let serializedTypeArguments = convertPayloadTypeArgsToMoveType(funcABI, {
    function: args.function,
    typeArguments: args.functionTypeArgs,
    functionArguments: args.functionArgs
  });
  const serializer = new DynamicTransactionSerializer();
  const serializedArguments = serializer.prepareTransactionArgs(
    args.functionArgs,
    funcABI.params.slice(1)
    // exclude signer 
  );
  return {
    typeArguments: serializedTypeArguments ?? [],
    functionArguments: serializedArguments ?? []
  };
}
async function simpleInternal(args, config) {
  let { functionArguments, typeArguments } = await generateTransactionPayload({
    function: args.function,
    functionTypeArgs: args.functionTypeArgs,
    functionArgs: args.functionArgs,
    abi: args.abi
  }, config);
  return rawTxnObjectInternal({
    senderAddress: args.senderAddress,
    senderSequenceNumber: args.senderSequenceNumber,
    function: args.function,
    functionTypeArgs: typeArguments,
    functionArgs: functionArguments,
    optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {}
  }, config);
}
function rawTxnObjectInnerInternal(args, config) {
  let senderAddress = typeof args.senderAddress === "string" ? new HexString5(args.senderAddress.toString()) : args.senderAddress;
  return new TxnBuilderTypes6.RawTransaction(
    new TxnBuilderTypes6.AccountAddress(senderAddress.toUint8Array()),
    args.senderSequenceNumber,
    args.payload,
    args.optionalTransactionPayloadArgs?.maxGas ?? config.maxGas ?? DEFAULT_MAX_GAS_UNITS,
    // If the user has not passed `gasUnitPrice` value then, we will use cached value of the
    // `min_gas_unit_price` assigned to `this.minGasUnitPrice` at the time of `SupraClient`
    // instantiation.
    args.optionalTransactionPayloadArgs?.gasUnitPrice ?? config.minGasUnitPrice ?? DEFAULT_GAS_PRICE,
    args.optionalTransactionPayloadArgs?.txExpiryTime ?? BigInt(
      Math.ceil(Date.now() / MILLISECONDS_PER_SECOND) + DEFAULT_TX_EXPIRATION_DURATION
    ),
    new TxnBuilderTypes6.ChainId(config.chainId)
  );
}
function rawTxnObjectInternal(args, config) {
  let payload = new TxnBuilderTypes6.TransactionPayloadEntryFunction(
    buildEntryFunctionInternal({
      function: args.function,
      functionTypeArgs: args.functionTypeArgs,
      functionArgs: args.functionArgs
    })
  );
  return rawTxnObjectInnerInternal({
    senderAddress: args.senderAddress,
    senderSequenceNumber: args.senderSequenceNumber,
    payload,
    optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {}
  }, config);
}
function buildEntryFunctionInternal(args) {
  let { moduleAddress, moduleName, functionName } = getFunctionParts(args.function);
  return new TxnBuilderTypes6.EntryFunction(
    new TxnBuilderTypes6.ModuleId(
      new TxnBuilderTypes6.AccountAddress(
        new HexString5(standardizeAddress(moduleAddress)).toUint8Array()
      ),
      new TxnBuilderTypes6.Identifier(moduleName)
    ),
    new TxnBuilderTypes6.Identifier(functionName),
    args.functionTypeArgs,
    args.functionArgs
  );
}
function signedTransactionInternal(args) {
  return new TxnBuilderTypes6.SignedTransaction(
    args.rawTxn,
    new TxnBuilderTypes6.AccountAuthenticatorEd25519(
      new TxnBuilderTypes6.Ed25519PublicKey(
        args.senderAccount.pubKey().toUint8Array()
      ),
      new TxnBuilderTypes6.Ed25519Signature(
        signTransactionInternal({ senderAccount: args.senderAccount, rawTxn: args.rawTxn }).toUint8Array()
      )
    )
  );
}
function getTransactionPayloadJSONInternal(txPayload) {
  if (txPayload instanceof TxnBuilderTypes6.TransactionPayloadEntryFunction) {
    return {
      EntryFunction: {
        module: {
          address: txPayload.value.module_name.address.toHexString().toString(),
          name: txPayload.value.module_name.name.value
        },
        function: txPayload.value.function_name.value,
        ty_args: parseFunctionTypeArgs(txPayload.value.ty_args),
        args: fromUint8ArrayToJSArray(txPayload.value.args)
      }
    };
  } else if (txPayload instanceof TxnBuilderTypes6.TransactionPayloadScript) {
    return {
      Script: {
        code: Array.from(txPayload.value.code),
        ty_args: parseFunctionTypeArgs(txPayload.value.ty_args),
        args: parseScriptArgs(txPayload.value.args)
      }
    };
  } else if (txPayload instanceof TxnBuilderTypes6.TransactionPayloadAutomationRegistration) {
    if (txPayload.value instanceof TxnBuilderTypes6.AutomationRegistrationParamsV1) {
      return {
        AutomationRegistration: {
          V1: {
            automated_function: {
              module: {
                address: txPayload.value.value.automated_function.module_name.address.toHexString().toString(),
                name: txPayload.value.value.automated_function.module_name.name.value
              },
              function: txPayload.value.value.automated_function.function_name.value,
              ty_args: parseFunctionTypeArgs(
                txPayload.value.value.automated_function.ty_args
              ),
              args: fromUint8ArrayToJSArray(
                txPayload.value.value.automated_function.args
              )
            },
            max_gas_amount: Number(txPayload.value.value.max_gas_amount),
            gas_price_cap: Number(txPayload.value.value.gas_price_cap),
            automation_fee_cap_for_epoch: Number(
              txPayload.value.value.automation_fee_cap_for_epoch
            ),
            expiration_timestamp_secs: Number(
              txPayload.value.value.expiration_timestamp_secs
            ),
            aux_data: fromUint8ArrayToJSArray(txPayload.value.value.aux_data)
          }
        }
      };
    } else {
      throw new Error("Unknown variant of `AutomationRegistrationParams`");
    }
  } else if (txPayload instanceof TxnBuilderTypes6.TransactionPayloadMultisig) {
    let multisig_address = txPayload.value.multisig_address.toHexString().toString();
    let payload = txPayload.value.transaction_payload?.transaction_payload;
    if (!payload) {
      throw new Error("Multisig payload is missing");
    }
    return {
      Multisig: {
        multisig_address,
        transaction_payload: {
          EntryFunction: {
            module: {
              address: payload.module_name.address.toHexString().toString(),
              name: payload.module_name.name.value
            },
            function: payload.function_name.value,
            ty_args: parseFunctionTypeArgs(payload.ty_args),
            args: fromUint8ArrayToJSArray(payload.args)
          }
        }
      }
    };
  } else {
    throw new Error("Unknown variant of `TransactionPayload`");
  }
}
function getRawTxnJSONInternal(rawTxn) {
  return {
    sender: rawTxn.sender.toHexString().toString(),
    sequence_number: Number(rawTxn.sequence_number),
    payload: getTransactionPayloadJSONInternal(rawTxn.payload),
    max_gas_amount: Number(rawTxn.max_gas_amount),
    gas_unit_price: Number(rawTxn.gas_unit_price),
    expiration_timestamp_secs: Number(rawTxn.expiration_timestamp_secs),
    chain_id: rawTxn.chain_id.value
  };
}
function sendTxnPayloadInternal(args) {
  let signature = signTransactionInternal({
    senderAccount: args.senderAccount,
    rawTxn: args.rawTxn
  });
  return {
    Move: {
      raw_txn: getRawTxnJSONInternal(args.rawTxn),
      authenticator: {
        Ed25519: {
          public_key: args.senderAccount.pubKey().toString(),
          signature: signature.toString()
        }
      }
    }
  };
}
function scriptRawTxnObjectInternal(args, config) {
  let payload = new TxnBuilderTypes6.TransactionPayloadScript(
    new TxnBuilderTypes6.Script(args.scriptCode, args.scriptTypeArgs, args.scriptArgs)
  );
  return rawTxnObjectInnerInternal({
    senderAddress: args.senderAddress,
    senderSequenceNumber: args.senderSequenceNumber,
    payload,
    optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {}
  }, config);
}
function automationRegistrationRawTxnObjectInternal(args, config) {
  let payload = new TxnBuilderTypes6.TransactionPayloadAutomationRegistration(
    new TxnBuilderTypes6.AutomationRegistrationParamsV1(
      new TxnBuilderTypes6.AutomationRegistrationParamsV1Data(
        buildEntryFunctionInternal({
          function: args.function,
          functionTypeArgs: args.functionTypeArgs,
          functionArgs: args.functionArgs
        }),
        args.automationMaxGasAmount,
        args.automationGasPriceCap,
        args.automationFeeCapForEpoch,
        args.automationExpirationTimestampSecs,
        args.automationAuxData
      )
    )
  );
  return rawTxnObjectInnerInternal({
    senderAddress: args.senderAddress,
    senderSequenceNumber: args.senderSequenceNumber,
    payload,
    optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {}
  }, config);
}
function multisigRawTxnObjectInternal(args, config) {
  let multisigAddress = typeof args.multisigAddress === "string" ? new HexString5(args.multisigAddress.toString()) : args.multisigAddress;
  let payload = new TxnBuilderTypes6.TransactionPayloadMultisig(
    new TxnBuilderTypes6.MultiSig(
      TxnBuilderTypes6.AccountAddress.fromHex(multisigAddress),
      new TxnBuilderTypes6.MultiSigTransactionPayload(
        buildEntryFunctionInternal({
          function: args.function,
          functionTypeArgs: args.functionTypeArgs,
          functionArgs: args.functionArgs
        })
      )
    )
  );
  return rawTxnObjectInnerInternal(
    {
      senderAddress: args.senderAddress,
      senderSequenceNumber: args.senderSequenceNumber,
      payload,
      optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {}
    },
    config
  );
}
function multisigProposalTxRawTxnObjectInternal(args, config) {
  let multisigAddress = typeof args.multisigAddress === "string" ? new HexString5(args.multisigAddress.toString()) : args.multisigAddress;
  let multisigPayload = new TxnBuilderTypes6.MultiSigTransactionPayload(
    buildEntryFunctionInternal({
      function: args.function,
      functionTypeArgs: args.functionTypeArgs,
      functionArgs: args.functionArgs
    })
  );
  let multisigPayloadHash = new HexString5(
    sha32.sha3_256(BCS6.bcsToBytes(multisigPayload))
  );
  return rawTxnObjectInternal(
    {
      senderAddress: args.senderAddress,
      senderSequenceNumber: args.senderSequenceNumber,
      function: `${SUPRA_FRAMEWORK_ADDRESS}::multisig_account::create_transaction_with_hash`,
      functionTypeArgs: [],
      functionArgs: [
        BCS6.bcsToBytes(TxnBuilderTypes6.AccountAddress.fromHex(multisigAddress)),
        BCS6.bcsSerializeBytes(multisigPayloadHash.toUint8Array())
      ],
      optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {}
    },
    config
  );
}
var ExtendedRawTransaction = class extends TxnBuilderTypes6.RawTransaction {
  constructor(config, ...args) {
    super(...args);
    this.config = config;
  }
  /**
   * Serialize the transaction to bytes
   * @returns bytes
   */
  toBytes() {
    return BCS6.bcsToBytes(this);
  }
  /**
   * Serialize the transaction to hex string
   * @returns hex string
   */
  toHexString() {
    return new HexString5(uint8ArrayToHexString(BCS6.bcsToBytes(this)));
  }
  /**
   * Create a signed transaction
   * @param args.senderAccount - Sender KeyPair
   * @returns `SignedTransaction`
   */
  signedTransaction(senderAccount) {
    return signedTransactionInternal({
      senderAccount,
      rawTxn: this
    });
  }
  /**
   * Create a send transaction payload
   * @param args.senderAccount - Sender KeyPair
   * @returns `SendTxnPayload`
   */
  sendTxnPayload(senderAccount) {
    return sendTxnPayloadInternal({
      senderAccount,
      rawTxn: this
    });
  }
  /**
   * Simulate the transaction
   * @param args.senderAccountOrAuthenticator - Sender KeyPair or MoveInnerAuthenticator
   * @returns `TransactionResponse`
   */
  simulate(senderAccountOrAuthenticator) {
    if (senderAccountOrAuthenticator instanceof SupraAccount2) {
      return simulateTxnInternal({
        sendTxPayload: sendTxnPayloadInternal({
          senderAccount: senderAccountOrAuthenticator,
          rawTxn: this
        })
      }, this.config);
    }
    return simulateSerializedTxnInternal({
      txAuthenticator: senderAccountOrAuthenticator,
      serializedRawTransaction: BCS6.bcsToBytes(this)
    }, this.config);
  }
  /**
   * Submit the transaction
   * @param args.senderAccount - Sender KeyPair
   * @returns `TransactionResponse`
   */
  submitTransaction(args) {
    return submitSerializedRawTransactionInternal({
      senderAccount: args.senderAccount,
      serializedRawTransaction: BCS6.bcsToBytes(this),
      enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {}
    }, this.config);
  }
  /**
   * Submit the transaction with signature
   * @param args.senderPubkey - Sender ed25519 pubkey
   * @param args.signature - Ed25519 signature
   * @returns `TransactionResponse`
   */
  submitTransactionAndSignature(args) {
    return submitSerializedRawTransactionAndSignatureInternal({
      serializedRawTransaction: BCS6.bcsToBytes(this),
      senderPubkey: args.senderPubkey,
      signature: args.signature,
      enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {}
    }, this.config);
  }
  /**
   * Submit the sponsor transaction
   * @param args.feePayerAddress - Fee payer address
   * @param args.secondarySignersAccountAddress - Secondary signers address
   * @param args.senderAuthenticator - Sender authenticator
   * @param args.feePayerAuthenticator - Fee payer authenticator
   * @param args.secondarySignersAuthenticator - Secondary signers authenticator
   * @returns `TransactionResponse`
   */
  submitSponsorTransaction(args) {
    return submitSponsorTransactionInternal({
      feePayerAddress: args.feePayerAddress,
      secondarySignersAccountAddress: args.secondarySignersAccountAddress,
      senderAuthenticator: args.senderAuthenticator,
      feePayerAuthenticator: args.feePayerAuthenticator,
      secondarySignersAuthenticator: args.secondarySignersAuthenticator,
      rawTxn: this,
      enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {}
    }, this.config);
  }
  /**
   * Submit the multi agent transaction
   * @param args.secondarySignersAccountAddress - Secondary signers address
   * @param args.senderAuthenticator - Sender authenticator
   * @param args.secondarySignersAuthenticator - Secondary signers authenticator
   * @returns `TransactionResponse`
   */
  submitMultiAgentTransaction(args) {
    return submitMultiAgentTransactionInternal({
      secondarySignersAccountAddress: args.secondarySignersAccountAddress,
      senderAuthenticator: args.senderAuthenticator,
      secondarySignersAuthenticator: args.secondarySignersAuthenticator,
      rawTxn: this,
      enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {}
    }, this.config);
  }
  /**
   * Sign the transaction
   * @param senderAccount - Sender account
   * @returns ed25519 signature in `HexString` or signer authenticator
   */
  signTransaction(senderAccount) {
    return signTransactionInternal({
      senderAccount,
      rawTxn: this
    });
  }
};
function extendedRawTransaction(args, config) {
  return new ExtendedRawTransaction(
    config,
    args.rawTxn.sender,
    args.rawTxn.sequence_number,
    args.rawTxn.payload,
    args.rawTxn.max_gas_amount,
    args.rawTxn.gas_unit_price,
    args.rawTxn.expiration_timestamp_secs,
    args.rawTxn.chain_id
  );
}

// src/internal/coin.ts
async function transferCoinInternal(args, config) {
  let receiverAccountAddress = typeof args.receiverAccountAddress === "string" ? new HexString6(args.receiverAccountAddress.toString()) : args.receiverAccountAddress;
  if (args.coinType == "0x1::supra_coin::SupraCoin" && args.optionalTransactionArgs?.optionalTransactionPayloadArgs && !args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.maxGas) {
    let maxGas = BigInt(
      DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_EXISTS
    );
    if (await isAccountExistsInternal({ accountAddress: receiverAccountAddress }, config) === false) {
      maxGas = BigInt(
        DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_NOT_EXISTS
      );
    }
    args.optionalTransactionArgs.optionalTransactionPayloadArgs.maxGas = maxGas;
  }
  let supraTransferPayload = {
    senderAddress: args.senderAccount.address(),
    senderSequenceNumber: (await getAccountInfoInternal({ accountAddress: args.senderAccount.address() }, config)).sequence_number,
    function: `${SUPRA_FRAMEWORK_ADDRESS}::supra_account::transfer_coins`,
    functionTypeArgs: [new TypeTagParser2(args.coinType).parseTypeTag()],
    functionArgs: [receiverAccountAddress.toUint8Array(), BCS7.bcsSerializeUint64(args.amount)]
  };
  let raw_txn = rawTxnObjectInternal(supraTransferPayload, config);
  let sendTxPayload = sendTxnPayloadInternal({ senderAccount: args.senderAccount, rawTxn: raw_txn });
  return await submitTxnInternal({
    sendTxJsonPayload: sendTxPayload,
    enableTransactionWaitAndSimulationArgs: args.optionalTransactionArgs?.enableTransactionWaitAndSimulationArgs ?? {}
  }, config);
}
async function getCoinInfoInternal(args, config) {
  return await getAccountResourceInternal({
    accountAddress: new HexString6(args.coinType.split("::")[0]),
    resourceType: `${SUPRA_FRAMEWORK_ADDRESS}::coin::CoinInfo<${args.coinType}>`
  }, config).then((res) => {
    return {
      name: res.data.name,
      symbol: res.data.symbol,
      decimals: res.data.decimals
    };
  });
}

// src/api/coin.ts
var Coin = class {
  /**
  * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
  */
  networkInformation;
  /**
  * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
  * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
  * @example
  * ```typescript
  * import { SupraClient,Network } from "supra-ts-sdk";
  * 
  * const supra = new SupraClient({ network: Network.TESTNET });
  * ```  
  * @group Coin
  */
  constructor(networkInformation) {
    this.networkInformation = networkInformation;
  }
  /**
   * Get coin info of the given coin type
   * @param args.coinType Type of a coin resource
   * @returns CoinInfo
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const coinType = "0x1::supra_coin::SupraCoin";
   *    const coinInfo = await supra.coin.getCoinInfo({ coinType: coinType });
   *    console.log(coinInfo);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group Coin
   */
  async getCoinInfo(args) {
    return getCoinInfoInternal(args, this.networkInformation);
  }
  /**
   * Transfer SupraCoin from one account to another.
   * @param args.senderAccount - The account sending the SupraCoin.
   * @param args.receiverAccountAddress - The address of the account receiving the SupraCoin.
   * @param args.amount - The amount of SupraCoin to transfer.
   * @param args.optionalTransactionArgs - Optional transaction arguments.
   * @returns A Promise that resolves to a TransactionResponse object.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const receiverAccountAddress = "0x2";
   *    const amount = 100;
   *    const transactionResponse = await supra.coin.transferSupraCoin({ senderAccount: senderAccount, receiverAccountAddress: receiverAccountAddress, amount: amount });
   *    console.log(transactionResponse);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group Coin
   */
  async transferSupraCoin(args) {
    return transferCoinInternal({
      ...args,
      coinType: "0x1::supra_coin::SupraCoin"
    }, this.networkInformation);
  }
  /**
   * Transfer a coin from one account to another.
   * @param args.senderAccount - The account sending the coin.
   * @param args.receiverAccountAddress - The address of the account receiving the coin.
   * @param args.amount - The amount of the coin to transfer.
   * @param args.coinType - The type of the coin to transfer.
   * @param args.optionalTransactionArgs - Optional transaction arguments.
   * @returns A Promise that resolves to a TransactionResponse object.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const receiverAccountAddress = "0x2";
   *    const amount = 100;
   *    const coinType = "0x1::supra_coin::SupraCoin";
   *    const transactionResponse = await supra.coin.transferCoin({ senderAccount: senderAccount, receiverAccountAddress: receiverAccountAddress, amount: amount, coinType: coinType });
   *    console.log(transactionResponse);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group Coin
   */
  async transferCoin(args) {
    return transferCoinInternal(args, this.networkInformation);
  }
};

// src/internal/contract.ts
import { BCS as BCS8, SupraAccount as SupraAccount3 } from "supra-l1-sdk-core";
async function callContractInternal(args, config) {
  const signers = [];
  const functionArguments = [];
  args.functionArguments.forEach((f) => {
    if (f instanceof SupraAccount3) {
      signers.push(f);
    } else {
      functionArguments.push(f);
    }
  });
  if (signers.length > 1) {
    throw new Error("Multi agent not supported");
  }
  const senderAccount = args.functionArguments[0];
  if (!(senderAccount instanceof SupraAccount3)) {
    throw new Error("Sender account must be SupraAccount");
  }
  const simpleRawTxn = await simpleInternal({
    senderAddress: senderAccount.address(),
    senderSequenceNumber: (await getAccountInfoInternal({ accountAddress: senderAccount.address() }, config)).sequence_number,
    function: args.function,
    functionTypeArgs: args.typeArguments ?? [],
    functionArgs: functionArguments,
    optionalTransactionPayloadArgs: args.optionalTransactionPayloadArgs ?? {},
    abi: args.abi
  }, config);
  return await submitSerializedRawTransactionInternal({
    senderAccount,
    serializedRawTransaction: BCS8.bcsToBytes(simpleRawTxn),
    enableTransactionWaitAndSimulationArgs: args.enableTransactionWaitAndSimulationArgs ?? {}
  }, config);
}

// src/api/contract.ts
var Contract = class {
  /**
  * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
  */
  networkInformation;
  /**
  * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
  * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
  * @example
  * ```typescript
  * import { SupraClient,Network } from "supra-ts-sdk";
  * 
  * const supra = new SupraClient({ network: Network.TESTNET });
  * ```  
  * @group Contract
  */
  constructor(networkInformation) {
    this.networkInformation = networkInformation;
  }
  /**
   * The fromABI function takes an array of MoveModule (Contract ABI) objects as input.
   * @beta
   * @param abis - An array of MoveModule (Contract ABI) objects.
   * @returns An object with a contracts property which contains view and entry properties.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const instance = supra.contract.fromABI([COIN_ABI] as const);
   *    let balance = await instance.contracts.coin.view.balance({
   *        functionArguments: ["0x10cdf6e0c4c5c762bb23be3eac5c7eaa272c1b4abe0573cd1386c5632b7992ca"],
   *        typeArguments: ["0x1::supra_coin::SupraCoin"]
   *    })
   *    console.log("Balance:", balance[0]);
   * }
   * 
   * runExample().catch(console.error);
   * 
   * ```  
   * @group Contract
   */
  fromABI(abis) {
    return {
      contracts: new Proxy(abis, {
        get: (_, prop) => {
          let abi = abis.find((a) => a.name === prop);
          if (!abi) throw new Error(`Contract ${prop} not found in ABI`);
          return {
            view: new Proxy(abi, {
              get: (target, prop2) => {
                return async (args = {}) => {
                  return await viewInternal({
                    function: `${target.address}::${target.name}::${prop2}`,
                    typeArguments: args.typeArguments ?? [],
                    functionArguments: args.functionArguments ?? [],
                    abi
                  }, this.networkInformation);
                };
              }
            }),
            entry: new Proxy(abi, {
              get: (target, prop2) => {
                return async (args) => {
                  return await callContractInternal({
                    ...args,
                    function: `${target.address}::${target.name}::${prop2}`,
                    abi
                  }, this.networkInformation);
                };
              }
            })
          };
        }
      })
    };
  }
};

// src/internal/events.ts
async function getEventsByTypeInternal(args, config) {
  let { data, cursor } = await get({
    path: `/events/${args.eventType}`,
    query: {
      start_height: args.options.startHeight,
      end_height: args.options.endHeight,
      limit: args.options.limit,
      start: args.options.start
    }
  }, config);
  return { response: data.data, cursor };
}

// src/api/events.ts
var Events = class {
  /**
  * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
  */
  networkInformation;
  /**
  * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
  * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
  * @example
  * ```typescript
  * import { SupraClient,Network } from "supra-ts-sdk";
  * 
  * const supra = new SupraClient({ network: Network.TESTNET });
  * ```  
  * @group Events
  */
  constructor(networkInformation) {
    this.networkInformation = networkInformation;
  }
  /**
   * Get coin info of the given coin type
   * @param args.eventType - Type of event
   * @param args.options.startHeight - Starting block height (inclusive)
   * @param args.options.endHeight - Ending block height (exclusive)
   * @param args.options.limit - Maximum number of events to return. Defaults to 20, max 100.
   * @param args.options.start - Cursor specifying where to start for pagination. Use the cursor returned by the previous request when making the next request.
   * @returns A Promise that resolves to an array of events.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const eventType = "0x1::coin::Transfer";
   *    const {response: events, cursor} = await supra.events.getEventByType({ eventType: eventType });
   *    console.log(events);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group Events
   */
  async getEventsByType(args) {
    return getEventsByTypeInternal(args, this.networkInformation);
  }
};

// src/internal/faucet.ts
async function fundAccountWithFaucetInternal(args, config) {
  if (config.name != "testnet" /* TESTNET */) {
    throw new Error("Faucet is only available on testnet");
  }
  let response = await get({
    path: `/wallet/faucet/${standardizeAddress(args.accountAddress)}`
  }, config);
  return {
    hash: response.data.Accepted
  };
}

// src/api/faucet.ts
var Faucet = class {
  /**
  * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
  */
  networkInformation;
  /**
  * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
  * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
  * @example
  * ```typescript
  * import { SupraClient,Network } from "supra-ts-sdk";
  * 
  * const supra = new SupraClient({ network: Network.TESTNET });
  * ```  
  * @group Faucet
  */
  constructor(networkInformation) {
    this.networkInformation = networkInformation;
  }
  /**
   * Fund an account with faucet for testnet.
   * @param args.accountAddress - The address to fund.
   * @returns A Promise that resolves to a FaucetTransactionResponse object.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const accountAddress = "0x1";
   *    const faucetResponse = await supra.faucet.fundAccountWithFaucet({ accountAddress: accountAddress });
   *    console.log(faucetResponse);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group Faucet
   */
  async fundAccountWithFaucet(args) {
    return fundAccountWithFaucetInternal(args, this.networkInformation);
  }
};

// src/internal/fungibleAsset.ts
import { BCS as BCS9, HexString as HexString7, TypeTagParser as TypeTagParser3 } from "supra-l1-sdk-core";
async function getFungibleAssetMetadataInternal(args, config) {
  return await getAccountResourceInternal({
    accountAddress: args.assetAddress,
    resourceType: `${SUPRA_FRAMEWORK_ADDRESS}::fungible_asset::Metadata`
  }, config).then((res) => res.data);
}
async function transferFungibleAssetInternal(args, config) {
  let receiverAccountAddress = typeof args.receiverAccountAddress === "string" ? new HexString7(args.receiverAccountAddress.toString()) : args.receiverAccountAddress;
  let assetAddress = typeof args.assetAddress === "string" ? new HexString7(args.assetAddress.toString()) : args.assetAddress;
  if (args.assetAddress == "0x000000000000000000000000000000000000000000000000000000000000000a" && args.optionalTransactionArgs?.optionalTransactionPayloadArgs && !args.optionalTransactionArgs?.optionalTransactionPayloadArgs?.maxGas) {
    let maxGas = BigInt(
      DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_EXISTS
    );
    if (await isAccountExistsInternal({ accountAddress: receiverAccountAddress }, config) === false) {
      maxGas = BigInt(
        DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_NOT_EXISTS
      );
    }
    args.optionalTransactionArgs.optionalTransactionPayloadArgs.maxGas = maxGas;
  }
  let supraTransferPayload = {
    senderAddress: args.senderAccount.address(),
    senderSequenceNumber: (await getAccountInfoInternal({ accountAddress: args.senderAccount.address() }, config)).sequence_number,
    function: `${SUPRA_FRAMEWORK_ADDRESS}::primary_fungible_store::transfer`,
    functionTypeArgs: [new TypeTagParser3("0x1::fungible_asset::Metadata").parseTypeTag()],
    functionArgs: [assetAddress.toUint8Array(), receiverAccountAddress.toUint8Array(), BCS9.bcsSerializeUint64(args.amount)]
  };
  let raw_txn = rawTxnObjectInternal(supraTransferPayload, config);
  let sendTxPayload = sendTxnPayloadInternal({ senderAccount: args.senderAccount, rawTxn: raw_txn });
  return await submitTxnInternal({
    sendTxJsonPayload: sendTxPayload,
    enableTransactionWaitAndSimulationArgs: args.optionalTransactionArgs?.enableTransactionWaitAndSimulationArgs ?? {}
  }, config);
}

// src/api/fungibleAsset.ts
var FungibleAsset = class {
  /**
  * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
  */
  networkInformation;
  /**
  * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
  * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
  * @example
  * ```typescript
  * import { SupraClient,Network } from "supra-ts-sdk";
  * 
  * const supra = new SupraClient({ network: Network.TESTNET });
  * ```  
  * @group FungibleAsset
  */
  constructor(networkInformation) {
    this.networkInformation = networkInformation;
  }
  /**
   * Get the metadata of a fungible asset.
   * @param args.assetAddress - The address of the fungible asset.
   * @returns A Promise that resolves to the metadata of the fungible asset.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const assetAddress = "0x1";
   *    const fungibleAssetMetadata = await supra.fungibleAsset.getFungibleAssetMetadata({ assetAddress: assetAddress });
   *    console.log(fungibleAssetMetadata);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group FungibleAsset
   */
  async getFungibleAssetMetadata(args) {
    return getFungibleAssetMetadataInternal(args, this.networkInformation);
  }
  /**
   * Transfer supra fungible asset from one account to another.
   * @param args.senderAccount - The account sending the SupraCoin.
   * @param args.receiverAccountAddress - The address of the account receiving the SupraCoin.
   * @param args.amount - The amount of SupraCoin to transfer.
   * @param args.optionalTransactionArgs - Optional transaction arguments.
   * @returns A Promise that resolves to a TransactionResponse object.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const receiverAccountAddress = "0x2";
   *    const amount = 100;
   *    const transactionResponse = await supra.fungibleAsset.transferSupraFungibleAsset({ senderAccount: senderAccount, receiverAccountAddress: receiverAccountAddress, amount: amount });
   *    console.log(transactionResponse);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group FungibleAsset
   */
  async transferSupraFungibleAsset(args) {
    return transferFungibleAssetInternal({
      ...args,
      assetAddress: "0x000000000000000000000000000000000000000000000000000000000000000a"
    }, this.networkInformation);
  }
  /**
   * Transfer a fungible asset from one account to another.
   * @param args.senderAccount - The account sending the coin.
   * @param args.receiverAccountAddress - The address of the account receiving the coin.
   * @param args.amount - The amount of the coin to transfer.
   * @param args.assetAddress - The address of the coin to transfer.
   * @param args.optionalTransactionArgs - Optional transaction arguments.
   * @returns A Promise that resolves to a TransactionResponse object.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const receiverAccountAddress = "0x2";
   *    const amount = 100;
   *    const assetAddress = "0x000000000000000000000000000000000000000000000000000000000000000a";
   *    const transactionResponse = await supra.fungibleAsset.transferFungibleAsset({ senderAccount: senderAccount, receiverAccountAddress: receiverAccountAddress, amount: amount, assetAddress: assetAddress });
   *    console.log(transactionResponse);
   * }
   * 
   * runExample().catch(console.error); 
   * ```
   * @group FungibleAsset
   */
  async transferFungibleAsset(args) {
    return transferFungibleAssetInternal(args, this.networkInformation);
  }
};

// src/api/methods.ts
var Methods = class {
  /**
  * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
  */
  networkInformation;
  /**
   * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
   * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-l1-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * ```
   * @group Methods
   */
  constructor(networkInformation) {
    this.networkInformation = networkInformation;
  }
  /**
   *  Queries for a Move view function
   * @template T - The type of the MoveValue array to be returned.
   * @param args.function - The name of the function to query.
   * @param args.typeArguments - An array of type arguments for the function.
   * @param args.functionArguments - An array of arguments for the function.
   * @returns A Promise that resolves to an array of MoveValue objects.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const accountAddress = "0x1";
   *    const supraCoin = new TypeTagParser("0x1::supra_coin::SupraCoin").parseTypeTag();
   *    const accountSupraBalance = await supra.methods.view({
   *        function: "0x1::coin::balance",
   *        functionArguments: [accountAddress],
   *        typeArguments: [supraCoin]
   *    });
   *    console.log("Account supra balance:", accountSupraBalance[0]);
   * }
   * 
   * runExample().catch(console.error);
   * ```
   * @group Methods
   */
  async view(args) {
    return viewInternal(args, this.networkInformation);
  }
  /**
   * Queries for a Move view function without type conversion or parsing
   * @template T - The type of the array to be returned.
   * @param args.function - The name of the function to query.
   * @param args.typeArguments - An array of type arguments for the function.
   * @param args.functionArguments - An array of arguments for the function.
   * @returns A Promise that resolves to an array of values.
   * @note This is for raw data without type conversion or parsing.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const accountAddress = "0x1";
   *    const accountSupraBalance = await supra.methods.viewRaw({
   *        function: "0x1::coin::balance",
   *        functionArguments: [accountAddress],
   *        typeArguments: ["0x1::supra_coin::SupraCoin"]
   *    });
   *    console.log("Account supra balance:", accountSupraBalance[0]);
   * }
   * 
   * runExample().catch(console.error);
   * ```
   * @group Methods
   */
  async viewRaw(args) {
    return viewRawInternal(args, this.networkInformation);
  }
};

// src/api/supraClient.ts
import { TxnBuilderTypes as TxnBuilderTypes9 } from "supra-l1-sdk-core";

// src/internal/table.ts
async function getTableItemInternal(args, config) {
  return await post({
    path: `/tables/${standardizeAddress(args.handle)}/item`,
    data: args.data
  }, config).then((res) => res);
}

// src/api/table.ts
var Table = class {
  /**
  * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
  */
  networkInformation;
  /**
   * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
   * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * ```  
   * @group Table
   */
  constructor(networkInformation) {
    this.networkInformation = networkInformation;
  }
  /**
   * Query a table item on Supra.
   * @template T - The type of the response data to be returned.
   * @param args.handle - The table handle.
   * @param args.data.key_type - The type of the table item's key.
   * @param args.data.value_type - The type of the table item's value.
   * param args.data.key - The value of the table item's key.
   * @returns A Promise that resolves to the table item's value.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const handle = "0x1";
   *    const key = "0x1";
   *    const keyType = "address";
   *    const valueType = "u64";
   *    const tableItem = await supra.table.getTableItem({ handle: handle, data: { key_type: keyType, value_type: valueType, key: key }});
   *    console.log(tableItem);
   * }
   * 
   * runExample().catch(console.error);
   * ``` 
   * @group Table
   */
  async getTableItem(args) {
    return getTableItemInternal(args, this.networkInformation);
  }
};

// src/api/transactionManager/txnBuild.ts
import "supra-l1-sdk-core";
var Build = class {
  /**
   * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
   */
  networkInformation;
  /**
   * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
   * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * ```  
   * @group Transaction
   */
  constructor(networkInformation) {
    this.networkInformation = networkInformation;
  }
  /**
   * Create raw transaction object for `simple` type txn
   * Don't need to serialize arguments as they serialize on the fly using function abi.
   * @param args.senderAddress - Sender account address
   * @param args.senderSequenceNumber - Sender account sequence number
   * @param args.function - Target function name as MoveFunctionId
   * @param args.functionTypeArgs - Target function type args
   * @param args.functionArgs - Target function args
   * @param args.optionalTransactionPayloadArgs - Optional arguments for transaction payload
   * @returns Raw transaction object
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   * 
   *     const supraCoinTransferRawTransaction = supra.transaction.build.simple({
   *         senderAddress: account.address(),
   *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
   *         function: "0x1::supra_account::transfer" as MoveFunctionId,
   *         functionTypeArgs: [],
   *         functionArgs: ["0x2", 10000]
   *     });
   * 
   *     console.log(supraCoinTransferRawTransaction);
   * }
   * ```
   * @group Transaction
   */
  async simple(args) {
    return extendedRawTransaction({ rawTxn: await simpleInternal(args, this.networkInformation) }, this.networkInformation);
  }
  /**
  * Create raw transaction object for `entry_function_payload` type txn
  * @param args.senderAddress - Sender account address
  * @param args.senderSequenceNumber - Sender account sequence number
  * @param args.function - Target function name as MoveFunctionId
  * @param args.functionTypeArgs - Target function type args
  * @param args.functionArgs - Target function args
  * @param args.optionalTransactionPayloadArgs - Optional arguments for transaction payload
  * @returns Raw transaction object
  * @example
  * ```typescript
  * import { SupraClient,Network } from "supra-ts-sdk";
  * 
  * const supra = new SupraClient({ network: Network.TESTNET });
  * 
  * async function runExample() {
  * 
  *     const supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject({
  *         senderAddress: account.address(),
  *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
  *         function: "0x1::supra_account::transfer" as MoveFunctionId,
  *         functionTypeArgs: [],
  *         functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(10000)]
  *     });
  * 
  *     console.log(supraCoinTransferRawTransaction);
  * }
  * 
  * runExample().catch(console.error);
  *  
  * ```
  * @group Transaction
  */
  rawTxnObject(args) {
    return extendedRawTransaction({ rawTxn: rawTxnObjectInternal(args, this.networkInformation) }, this.networkInformation);
  }
  /**
  * Create raw transaction for `script_payload` type txn
  * @param args.senderAddress - Sender account address
  * @param args.senderSequenceNumber - Sender account sequence number
  * @param args.scriptCode - Move script bytecode
  * @param args.scriptTypeArgs - Type arguments that move script bytecode requires
  * @param args.scriptArgs - Arguments to the move script bytecode function
  * @param args.optionalTransactionPayloadArgs - Optional arguments for transaction payload
  * @returns Raw script transaction object
  * @example
  * ```typescript
  * import { SupraClient,Network } from "supra-ts-sdk";
  *
  * const supra = new SupraClient({ network: Network.TESTNET });
  *
  * async function runExample() {
  *
  *     let moveScriptCodeHex = "a11ceb0b06000000050100040...";
  *
  *     let supraCoinTransferSerializedScriptRawTransaction = supra.transaction.build.scriptRawTxnObject({
  *         senderAddress: account.address(),
  *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
  *         scriptCode: Uint8Array.from(Buffer.from(moveScriptCodeHex, "hex")),
  *         scriptTypeArgs: [],
  *         scriptArgs: [new TxnBuilderTypes.TransactionArgumentU64(BigInt(1000))]
  *     }).toBytes();
  *
  *     console.log(supraCoinTransferSerializedScriptRawTransaction);
  * }
  *
  * runExample().catch(console.error);
  *
  * ```
  * @group Transaction
  */
  scriptRawTxnObject(args) {
    return extendedRawTransaction({ rawTxn: scriptRawTxnObjectInternal(args, this.networkInformation) }, this.networkInformation);
  }
  /**
   * Create raw transaction object for `automation_registration_payload` type txn
   * @param args.senderAddress - Sender account address
   * @param args.senderSequenceNumber - Sender account sequence number
   * @param function - Target function name as MoveFunctionId
   * @param args.functionTypeArgs - Target function type args
   * @param args.functionArgs - Target function args
   * @param args.automationMaxGasAmount - Max gas amount for automated transaction
   * @param args.automationGasPriceCap - Gas Uint price upper limit that user is willing to pay
   * @param args.automationFeeCapForEpoch - Maximum automation fee that user is willing to pay for epoch.
   * @param args.automationFeeCapForEpoch - Expiration time of the automated transaction in seconds since UTC Epoch start.
   * @param args.automationAuxData - Reserved for future extensions of registration parameters.
   * @param optionalTransactionPayloadArgs Optional arguments for transaction payload
   * @returns Raw transaction object
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   *
   * const supra = new SupraClient({ network: Network.TESTNET });
   *
   * async function runExample() {
   *
   *     let supraCoinTransferAutomationSerializedRawTransaction = supra.transaction.build.automationRegistrationRawTxnObject({
   *         senderAddress: account.address(),
   *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
   *         function: "0x1::supra_account::transfer" as MoveFunctionId,
   *         functionTypeArgs: [],
   *         functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000)],
   *         automationMaxGasAmount: BigInt(500),
   *         automationGasPriceCap: BigInt(100),
   *         automationFeeCapForEpoch: BigInt(1000000000),
   *         automationExpirationTimestampSecs: BigInt(Math.floor(Date.now() / MILLISECONDS_PER_SECOND) + 2 * 60 * 60),
   *         automationAuxData: [],
   *     }).toBytes();
   *
   *     console.log(supraCoinTransferAutomationSerializedRawTransaction);
   * }
   *
   * runExample().catch(console.error);
   *
   * ```
   * @group Transaction
   */
  automationRegistrationRawTxnObject(args) {
    return extendedRawTransaction({ rawTxn: automationRegistrationRawTxnObjectInternal(args, this.networkInformation) }, this.networkInformation);
  }
  /**
   * Create raw transaction object for `multisig_payload` type txn
   * @param args.senderAddress - Sender account address
   * @param args.senderSequenceNumber - Sender account sequence number
   * @param args.multisigAddress - Multisig account address
   * @param args.function - Target function name as MoveFunctionId
   * @param args.functionTypeArgs - Target function type args
   * @param args.functionArgs - Target function args
   * @param args.optionalTransactionPayloadArgs Optional arguments for transaction payload
   * @returns Raw transaction object
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   *
   * const supra = new SupraClient({ network: Network.TESTNET });
   *
   * async function runExample() {
   *
   *     let supraCoinTransferSerializedMultisigRawTransaction = supra.transaction.build.multisigRawTxnObject({
   *         senderAddress: account.address(),
   *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
   *         multisigAddress: multisigAccountAddress,
   *         function: "0x1::supra_account::transfer",
   *         functionTypeArgs: [],
   *         functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000)]
   *     }).toBytes();
   *
   *     console.log(supraCoinTransferSerializedMultisigRawTransaction);
   * }
   *
   * runExample().catch(console.error);
   *
   * ```
   * @group Transaction
   */
  multisigRawTxnObject(args) {
    return extendedRawTransaction({ rawTxn: multisigRawTxnObjectInternal(args, this.networkInformation) }, this.networkInformation);
  }
  /**
  * Create raw transaction object to create multisig transaction
  * @param args.senderAddress - Sender account address
  * @param args.senderSequenceNumber - Sender account sequence number
  * @param args.multisigAddress - Multisig account address
  * @param args.function - Target function name as MoveFunctionId
  * @param args.functionTypeArgs - Target function type args
  * @param args.functionArgs - Target function args
  * @param args.optionalTransactionPayloadArgs - Optional arguments for transaction payload
  * @returns Raw transaction object
  * @example
  * ```typescript
  * import { SupraClient,Network } from "supra-ts-sdk";
  *
  * const supra = new SupraClient({ network: Network.TESTNET });
  *
  * async function runExample() {
  *
  *     let supraCoinTransferSerializedMultisigHashedRawTransaction = supra.transaction.build.multisigProposalTxRawTxnObject(
  *         {
  *             senderAddress: account.address(),
  *             senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
  *             multisigAddress: multisigAccountAddress,
  *             function: "0x1::supra_account::transfer",
  *             functionTypeArgs: [],
  *             functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(1000)]
  *         }
  *     ).toBytes();
  *
  *     console.log(supraCoinTransferSerializedMultisigHashedRawTransaction);
  * }
  *
  * runExample().catch(console.error);
  *
  * ```
  * @group Transaction
  */
  multisigProposalTxRawTxnObject(args) {
    return extendedRawTransaction({ rawTxn: multisigProposalTxRawTxnObjectInternal(args, this.networkInformation) }, this.networkInformation);
  }
  /**
   * Create signed transaction payload
   * @param args.senderAccount - Sender KeyPair
   * @param args.rawTxn - Raw transaction payload
   * @returns `SignedTransaction`
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   * 
   *     const supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject({
   *         senderAddress: account.address(),
   *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
   *         function: "0x1::supra_account::transfer" as MoveFunctionId,
   *         functionTypeArgs: [],
   *         functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(10000)]
   *     });
   * 
   *     const signedTransaction = supra.transaction.build.signedTransaction({
   *         senderAccount: account,
   *         rawTxn: supraCoinTransferRawTransaction
   *     });
   *     
   *     // Convert to SendTxPayload to send transaction
   *     console.log(signedTransaction);
   * }
   * 
   * runExample().catch(console.error);
   *  
   * ```
   * @group Transaction
   */
  signedTransaction(args) {
    return signedTransactionInternal(args);
  }
  /**
   * Generate `SendTxnPayload` using `RawTransaction` to send transaction request
   * Generated data can be used to send transaction directly using `/rpc/v3/transactions/submit` endpoint of `rpc_node`
   * @param args.senderAccount - Sender KeyPair
   * @param args.rawTxn - Raw transaction data
   * @returns `SendTxPayload`
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   * 
   *     const supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject({
   *         senderAddress: account.address(),
   *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
   *         function: "0x1::supra_account::transfer" as MoveFunctionId,
   *         functionTypeArgs: [],
   *         functionArgs: [receiverAddress.toUint8Array(), BCS.bcsSerializeUint64(10000)]
   *     });
   * 
   *     const supraCoinTransferSendTxnPayload = supra.transaction.build.sendTxnPayload({
   *         senderAccount: account,
   *         rawTxn: supraCoinTransferRawTransaction
   *     });
   * 
   *     let txn = await fetch("https://rpc-testnet.supra.com/rpc/v3/transactions/submit", {
   *         method: "POST",
   *         body: JSON.stringify(supraCoinTransferSendTxnPayload),
   *         headers: {
   *             "Content-Type": "application/json"
   *         }
   *     });
   * 
   *     console.log("Transaction submitted:", await txn.json());
   * 
   * }
   * 
   * runExample().catch(console.error);
   *  
   * ```  
   * @group Transaction
   */
  sendTxnPayload(args) {
    return sendTxnPayloadInternal(args);
  }
};

// src/api/transaction.ts
import { BCS as BCS11 } from "supra-l1-sdk-core";

// src/api/transactionManager/txnSimulate.ts
var Simulate = class {
  /**
   * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
   */
  networkInformation;
  /**
   * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
   * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * ```  
   * @group Transaction
   */
  constructor(networkInformation) {
    this.networkInformation = networkInformation;
  }
  /**
   * Simulate a transaction using the provided transaction payload
   * @param args.sendTxPayload -  Transaction payload 
   * @returns Transaction simulation result
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *   // Simulate a transaction use sendTxPayload
   *   const response = await supra.transaction.simulate.simple({ sendTxPayload: { ... } }); // replace with a real transaction payload
   * 
   *   console.log(response);
   * }
   * runExample().catch(console.error);
   * ```
   * @group Transaction
   */
  async simple(args) {
    return simulateTxnInternal(args, this.networkInformation);
  }
  /**
   * Simulate a transaction using the provided Serialized raw transaction data
   * @param args.txAuthenticator - Transaction authenticator
   * @param args.serializedRawTransaction - Serialized raw transaction data
   * @returns Transaction simulation result
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *   // Simulate a transaction use serializedRawTransaction
   *   const response = await supra.transaction.simulate.serialized({ txAuthenticator: { ... }, serializedRawTransaction: Uint8Array.from([1,2,3]) }); // replace with a real transaction payload
   * 
   *   console.log(response);
   * }
   * runExample().catch(console.error);
   * ```
   * @group Transaction
   */
  async serialized(args) {
    return simulateSerializedTxnInternal(args, this.networkInformation);
  }
};

// src/api/transactionManager/txnSubmit.ts
import { BCS as BCS10 } from "supra-l1-sdk-core";
var Submit = class {
  /**
   * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
   */
  networkInformation;
  /**
   * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
   * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * ```  
   * @group Transaction
   */
  constructor(networkInformation) {
    this.networkInformation = networkInformation;
  }
  /**
   * Send `entry_function_payload` type tx using raw transaction data
   * @param args.senderAccount - The sender account
   * @param args.rawTransaction - The raw transaction to be submitted
   * @param args.enableTransactionWaitAndSimulationArgs - enable transaction wait and simulation arguments
   * @returns `TransactionResponse`
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *  
   *   let supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload)
   * 
   *   let txn = await supra.transaction.submit.submitRawTransaction({
   *       senderAccount: account,
   *       rawTransaction: supraCoinTransferRawTransaction,
   *       enableTransactionWaitAndSimulationArgs: {
   *           enableTransactionSimulation: true,
   *           enableWaitForTransaction: true
   *       }
   *   });
   * 
   *   console.log("Transaction submitted:", txn);
   * }
   * ```
   * @group Transaction
   */
  async submitRawTransaction(args) {
    return submitSerializedRawTransactionInternal({ ...args, serializedRawTransaction: BCS10.bcsToBytes(args.rawTransaction) }, this.networkInformation);
  }
  /**
   * Send `entry_function_payload` type tx using serialized raw transaction data
   * @param args.senderAccount - The sender account
   * @param args.serializedRawTransaction - Serialized raw transaction data
   * @param args.enableTransactionWaitAndSimulationArgs - enable transaction wait and simulation arguments
   * @returns `TransactionResponse`
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *  
   *   let supraCoinTransferRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload)
   * 
   *   let supraCoinTransferRawTransactionSerializer = new BCS.Serializer();
   *   supraCoinTransferRawTransaction.serialize(
   *       supraCoinTransferRawTransactionSerializer
   *   );
   * 
   *   let txn = await supra.transaction.submit.submitSerializedRawTransaction({
   *       senderAccount: account,
   *       serializedRawTransaction: supraCoinTransferRawTransactionSerializer.getBytes(),
   *       enableTransactionWaitAndSimulationArgs: {
   *           enableTransactionSimulation: true,
   *           enableWaitForTransaction: true
   *       }
   *   });
   * 
   *   console.log("Transaction submitted:", txn);
   * }
   * 
   * runExample().catch(console.error);
   * ```
   * @group Transaction
   */
  async submitSerializedRawTransaction(args) {
    return submitSerializedRawTransactionInternal(args, this.networkInformation);
  }
  /**
   * Send `entry_function_payload` type tx using serialized raw transaction data and ed25519 signature
   * @param args.senderPubkey - Sender ed25519 pubkey
   * @param args.signature - Ed25519 signature
   * @param args.serializedRawTransaction - Serialized raw transaction data
   * @param args.enableTransactionWaitAndSimulationArgs - enable transaction wait and simulation arguments
   * @returns `TransactionResponse`
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *  
   *   let supraCoinTransferSerializedRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload)
   * 
   *   let raw_txn = TxnBuilderTypes.RawTransaction.deserialize(
   *       new BCS.Deserializer(supraCoinTransferSerializedRawTransaction),
   *   );
   * 
   *   let signature = supra.transaction.signTransaction({ senderAccount: account, rawTxn: raw_txn });
   * 
   *   let txn = await supra.transaction.submit.submitSerializedRawTransactionAndSignature({
   *       senderPubkey: account.pubKey(),
   *       signature: signature as HexString,
   *       serializedRawTransaction: supraCoinTransferSerializedRawTransaction,
   *       enableTransactionWaitAndSimulationArgs: {
   *           enableTransactionSimulation: true,
   *           enableWaitForTransaction: true
   *       }
   *   });
   * 
   *   console.log("Transaction submitted:", txn);
   * }
   * 
   * runExample().catch(console.error);
   * ```
   * @group Transaction
   * 
   */
  async submitSerializedRawTransactionAndSignature(args) {
    return submitSerializedRawTransactionAndSignatureInternal(args, this.networkInformation);
  }
  /**
   * Sends sponsor transaction
   * @param args.feePayerAddress - Account address of tx fee payer
   * @param args.secondarySignersAccountAddress - List of account address of tx secondary signers
   * @param args.rawTransaction - The raw transaction to be submitted
   * @param args.senderAuthenticator - The sender account authenticator
   * @param args.feePayerAuthenticator - The fee payer account authenticator
   * @param args.secondarySignersAuthenticator - An optional array of the secondary signers account authenticator
   * @param args.enableTransactionWaitAndSimulationArgs - enable transaction wait and simulation arguments
   * @returns `TransactionResponse`
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *  
   *   let supraCoinTransferSponsoredRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload);
   * 
   *   let sponsorTransactionPayload = new TxnBuilderTypes.FeePayerRawTransaction(
   *       supraCoinTransferSponsoredRawTransaction,
   *       [],
   *       new TxnBuilderTypes.AccountAddress(feePayerAccount.address().toUint8Array())
   *   );
   * 
   *   let sponsorTxnSenderAuthenticator = supra.transaction.signTransaction({
   *       senderAccount: account,
   *       rawTxn: sponsorTransactionPayload
   *   }) as TxnBuilderTypes.AccountAuthenticatorEd25519;
   * 
   *   let feePayerAuthenticator = supra.transaction.signTransaction({
   *       senderAccount: feePayerAccount,
   *       rawTxn: sponsorTransactionPayload
   *   }) as TxnBuilderTypes.AccountAuthenticatorEd25519;
   * 
   *   let txn = await supra.transaction.submit.submitSponsorTransaction({
   *       feePayerAddress: feePayerAccount.address().toString(),
   *       secondarySignersAccountAddress: [],
   *       rawTxn: supraCoinTransferSponsoredRawTransaction,
   *       senderAuthenticator: sponsorTxnSenderAuthenticator,
   *       feePayerAuthenticator: feePayerAuthenticator,
   *       secondarySignersAuthenticator: [],
   *       enableTransactionWaitAndSimulationArgs: {
   *           enableTransactionSimulation: true,
   *           enableWaitForTransaction: true
   *       }
   *   });
   * 
   *   console.log("Transaction submitted:", txn);
   * }
   * 
   * runExample().catch(console.error);
   * ```
   * @group Transaction
   *      
   */
  async submitSponsorTransaction(args) {
    return submitSponsorTransactionInternal(args, this.networkInformation);
  }
  /**
   * Sends multi-agent transaction
   * @param args.secondarySignersAccountAddress - List of account address of tx secondary signers
   * @param args.rawTxn - The raw transaction to be submitted
   * @param args.senderAuthenticator - The sender account authenticator
   * @param args.secondarySignersAuthenticator - List of the secondary signers account authenticator
   * @param args.enableTransactionWaitAndSimulationArgs - enable transaction wait and simulation arguments
   * @returns `TransactionResponse`
   * @example
   * ```typescript
   * import {SupraClient,Network} from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   * 
   *     let multiAgentRawTransaction = supra.transaction.build.rawTxnObject({
   *         senderAddress: account.address(),
   *         senderSequenceNumber: (await supra.account.getAccountInfo({ accountAddress: account.address() })).sequence_number,
   *         function: "0x7c6033ca961856298e1412fddf5ebb732c247436046d33016a5bd10f7e090a07::wrapper::two_signers" as MoveFunctionId,
   *         functionTypeArgs: [],
   *         functionArgs: []
   *     });
   * 
   *     // Creating Multi-Agent Transaction Payload
   *     let multiAgentTransactionPayload =
   *         new TxnBuilderTypes.MultiAgentRawTransaction(multiAgentRawTransaction, [
   *             new TxnBuilderTypes.AccountAddress(
   *                 secondarySignerAccount.address().toUint8Array()
   *             ),
   *         ]);
   * 
   *     // Generating sender authenticator
   *     let multiAgentSenderAuthenticator = supra.transaction.signTransaction({
   *         senderAccount: account,
   *         rawTxn: multiAgentTransactionPayload
   *     }) as TxnBuilderTypes.AccountAuthenticatorEd25519;
   * 
   *     // Generating Secondary Signer authenticator
   *     let secondarySignerAuthenticator = supra.transaction.signTransaction({
   *         senderAccount: secondarySignerAccount,
   *         rawTxn: multiAgentTransactionPayload
   *     }) as TxnBuilderTypes.AccountAuthenticatorEd25519;
   * 
   *     // Sending Multi-Agent transaction
   *     let txn = await supra.transaction.submit.submitMultiAgentTransaction({
   *         secondarySignersAccountAddress: [secondarySignerAccount.address().toString()],
   *         rawTxn: multiAgentRawTransaction,
   *         senderAuthenticator: multiAgentSenderAuthenticator,
   *         secondarySignersAuthenticator: [secondarySignerAuthenticator],
   *         enableTransactionWaitAndSimulationArgs: {
   *             enableWaitForTransaction: true,
   *             enableTransactionSimulation: true,
   *         }
   *     });
   * 
   *     console.log("Transaction submitted:", txn);
   * }
   * runExample().catch(console.error);
   * ```
   * @group Transaction
   */
  async submitMultiAgentTransaction(args) {
    return submitMultiAgentTransactionInternal(args, this.networkInformation);
  }
};

// src/api/transaction.ts
import sha33 from "js-sha3";
var Transaction = class {
  /**
   * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
   */
  networkInformation;
  /**
   * The build property is an instance of the Build class, which is used to build transactions.
   */
  build;
  /**
   * The simulate property is an instance of the Simulate class, which is used to simulate transactions.
   */
  simulate;
  /**
   * The submit property is an instance of the Submit class, which is used to submit transactions.
   */
  submit;
  /**
  * The constructor function takes a NetworkConfig object as a parameter and assigns it to the networkInformation property.
  * @param networkInformation - A NetworkConfig object that contains information about the network on which the Supra client is running.
  * @example
  * ```typescript
  * import { SupraClient,Network } from "supra-ts-sdk";
  * 
  * const supra = new SupraClient({ network: Network.TESTNET });
  * ```  
  * @group Transaction
  */
  constructor(networkInformation) {
    this.networkInformation = networkInformation;
    this.build = new Build(networkInformation);
    this.simulate = new Simulate(networkInformation);
    this.submit = new Submit(networkInformation);
  }
  /**
  * Queries on-chain transactions by their transaction hash, returning both pending and committed transactions.
  * @template {TransactionResponse} T - The type of the transaction to be returned.
  * @param args - The arguments for querying the transaction.
  * @param args.transactionHash - The transaction hash should be a hex-encoded bytes string with a 0x prefix.
  * @param args.type - The type of transaction to query.
  * @param args.exclude_uncommitted - Whether to exclude uncommitted transactions.
  * @returns A Promise that resolves to a TransactionResponse object.
  * @example
  * ```typescript
  * import {SupraClient, Network} from "supra-l1-sdk";
  *
  * const supra = new SupraClient({ network: Network.TESTNET });
  *
  * async function runExample() {
  *   // Fetch a transaction by its hash
  *   const transaction = await supra.getTransactionByHash({ transactionHash: "0x123" }); // replace with a real transaction hash
  *
  *   console.log(transaction);
  * }
  * runExample().catch(console.error);
  * ```
  * @group Transaction
  */
  async getTransactionByHash(args) {
    validateTransactionHash(args.transactionHash);
    return getTransactionByHashInternal(args, this.networkInformation);
  }
  /**
  * Queries on-chain transactions by their transaction hash, returning both transactions status.
  * @param args - The arguments for querying the transaction.
  * @param args.transactionHash - The transaction hash should be a hex-encoded bytes string with a 0x prefix.
  * @returns A Promise that resolves to a boolean.
  * @example
  * ```typescript
  * import {Supra, Network} from "supra-l1-sdk";
  *
  * const supra = new SupraClient({ network: Network.TESTNET });
  *
  * async function runExample() {
  *   // Fetch a transaction by its hash
  *   const isPending = await supra.isPendingTransaction({ transactionHash: "0x123" }); // replace with a real transaction hash
  *
  *   console.log(isPending);
  * }
  * runExample().catch(console.error);
  * ```
  * @group Transaction
  */
  async isPendingTransaction(args) {
    validateTransactionHash(args.transactionHash);
    return isPendingTransactionInternal(args, this.networkInformation);
  }
  /**
   * Queries on-chain transactions by their transaction hash, returning both pending and committed transactions.
   * @param args.transactionHash - The transaction hash should be a hex-encoded bytes string with a 0x prefix.
   * @param args.options.timeoutSecs - The maximum number of seconds to wait for the transaction to be committed. default: 20 seconds
   * @param args.options.checkSuccess - Whether to check the success of the transaction.
   * @returns A Promise that resolves to a CommittedTransactionResponse object.
   * @example
   * ```typescript
   * import {Supra, Network} from "supra-l1-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *   // Fetch a transaction by its hash
   *   const transaction = await supra.transaction.waitForTransaction({ transactionHash: "0x123" }); // replace with a real transaction hash
   * 
   *   console.log(transaction);
   * }
   * 
   * runExample().catch(console.error);
   * ```
   * @group Transaction
   */
  async waitForTransaction(args) {
    validateTransactionHash(args.transactionHash);
    return waitForTransactionInternal(args, this.networkInformation);
  }
  /**
   * Generates signature message for supra transaction using `AnyRawTransaction`
   * @param args.rawTxn a RawTransaction, MultiAgentRawTransaction or FeePayerRawTransaction
   * @returns Signature message
   * @example
   * ```typescript
   * import {Supra, Network} from "supra-l1-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   * 
   *   let supraCoinTransferSponsoredRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload);
   * 
   *   // Fetch a transaction by its hash
   *   const signatureMessage = await supra.getTransactionSignatureMessage({ rawTxn: supraCoinTransferSponsoredRawTransaction }); // replace with a real transaction hash
   * 
   *   console.log(signatureMessage);
   * }
   * 
   * runExample().catch(console.error);
   * ```
   * @group Transaction
   */
  getTransactionSignatureMessage(args) {
    return getTransactionSignatureMessageInternal(args);
  }
  /**
   * Sign any supra transaction.
   * signer authenticator to be used to submit the transaction.
   * @param args.senderAccount the account to sign on the transaction
   * @param args.rawTxn a RawTransaction, MultiAgentRawTransaction or FeePayerRawTransaction
   * @returns ed25519 signature in `HexString` or signer authenticator
   * @example
   * ```typescript
   * import {Supra, Network} from "supra-l1-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   * 
   *   let supraCoinTransferSponsoredRawTransaction = supra.transaction.build.rawTxnObject(supraTransferPayload);
   * 
   *   // Fetch a transaction by its hash
   *   const signature = await supra.signTransaction({ senderAccount: account, rawTxn: supraCoinTransferSponsoredRawTransaction }); // replace with a real transaction hash
   * 
   *   console.log(signature);
   * }
   * 
   * runExample().catch(console.error);
   * ```
   * @group Transaction
   */
  signTransaction(args) {
    return signTransactionInternal(args);
  }
  /**
   * Derives the transaction hash from a signed transaction.
   * @param args.signedTransaction - The signed transaction.
   * @returns The transaction hash.
   * @group Transaction
   */
  deriveTransactionHash(args) {
    return sha33.keccak256(BCS11.bcsToBytes(args.signedTransaction));
  }
  /**
  * Publish package or module on supra network
  * @param args.senderAccount - Module Publisher KeyPair
  * @param args.packageMetadata - Package Metadata
  * @param args.modulesCode - module code
  * @param args.optionalTransactionArgs optional arguments for transaction
  * @returns `TransactionResponse`
  * @example
  * ```typescript
  * import { SupraClient,Network } from "supra-ts-sdk";
  * 
  * const supra = new SupraClient({ network: Network.TESTNET });
  * 
  * async function runExample() {
  * 
  *   const response = await supra.transaction.publishPackage({
  *      senderAccount: account,
  *      packageMetadata: Uint8Array.from([]),
  *      modulesCode: [Uint8Array.from([])],
  *   });
  * 
  *   console.log(response);
  * }
  * runExample().catch(console.error);
  * ```
  * @group Transaction
  */
  async publishPackage(args) {
    return publishPackageInternal(args, this.networkInformation);
  }
};

// src/internal/supraClient.ts
async function getGasPriceInternal(config) {
  return BigInt(await get({
    path: `/rpc/v3/transactions/estimate_gas_price`
  }, config).then((res) => res.data.median_gas_price));
}
async function getMinGasUnitPriceInternal(config) {
  return BigInt(await get({
    path: `/rpc/v3/transactions/estimate_gas_price`
  }, config).then((res) => res.data.min_configured_gas_price));
}

// src/api/supraClient.ts
var SupraClient = class {
  /**
   * SupraConfig is the configuration object for the SupraClient class. It contains the network property which can be either "mainnet" or "testnet".
   */
  config;
  /**
   * The networkInformation property is A NetworkConfig object that contains information about the network on which the Supra client is running.
   */
  networkInformation;
  /**
   * Account instance provides methods for interacting with accounts related operations on the Supra network.
   */
  account;
  /**
   * Transaction instance provides methods for interacting with transactions related operations on the Supra network.
   */
  transaction;
  /**
   * Contract instance provides methods for interacting with contracts related operations on the Supra network. 
   */
  contract;
  /**
   * Faucet instance provides methods for interacting with faucets related operations on the Supra network.
   */
  faucet;
  /**
   * Methods instance provides general functions for interacting with the Supra network.
   */
  methods;
  /**
   * Table instance provides methods for interacting with tables related operations on the Supra network.
   */
  table;
  /**
   * Coin instance provides methods for interacting with coin related operations on the Supra network.
   */
  coin;
  /**
   * Events instance provides methods for interacting with events related operations on the Supra network.
   */
  events;
  /**
   * Block instance provides methods for interacting with block related operations on the Supra network.
   */
  block;
  /**
   * FungibleAsset instance provides methods for interacting with fungible asset related operations on the Supra network.
   */
  fungibleAsset;
  /**
  * The constructor function takes a SupraConfig object as a parameter and assigns it to the config property.
  * @param config - A SupraConfig object that contains information about the network on which the Supra client is running.
  * @note - You don't need to pass the rpc url or chain id it will be set automatically.
  * @example
  * ```typescript
  * import { SupraClient,Network } from "supra-ts-sdk";
  * 
  * // Options:1 (Default configuration)
  * const supra = new SupraClient({ network: Network.TESTNET }); 
  * 
  * 
  * // Options:2 (Custom configuration)
  * const supra = new SupraClient({ network: Network.CUSTOM, rpcUrl: "https://rpc-testnet.supra.com", chainId: 6 });
  * 
  * 
  * // Options:3 (Custom configuration)
  * const supra = new SupraClient({ rpcUrl: "https://rpc-testnet.supra.com", chainId: 6 }); 
  * 
  * ```  
  * @group SupraClient
  */
  constructor(config) {
    this.config = config;
    if ("rpcUrl" in config && "chainId" in config) {
      this.networkInformation = {
        name: "custom" /* CUSTOM */,
        chainId: config.chainId,
        rpcUrl: config.rpcUrl
      };
    } else {
      this.networkInformation = NetworkInfo[config.network];
    }
    this.networkInformation.maxGas = config.maxGas ?? DEFAULT_MAX_GAS_UNITS;
    this.networkInformation.minGasUnitPrice = config.minGasUnitPrice ?? DEFAULT_GAS_PRICE;
    this.account = new Account(this.networkInformation);
    this.transaction = new Transaction(this.networkInformation);
    this.contract = new Contract(this.networkInformation);
    this.methods = new Methods(this.networkInformation);
    this.faucet = new Faucet(this.networkInformation);
    this.table = new Table(this.networkInformation);
    this.coin = new Coin(this.networkInformation);
    this.events = new Events(this.networkInformation);
    this.block = new Block(this.networkInformation);
    this.fungibleAsset = new FungibleAsset(this.networkInformation);
  }
  /**
   * Get Chain Id Of Supra Network
   * @returns Chain Id of network
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const chainId = await supra.getChainId();
   *    console.log(chainId);
   * }
   * 
   * runExample().catch(console.error);
   * ```
   * @group SupraClient
   */
  getChainId() {
    return new TxnBuilderTypes9.ChainId(
      Number(this.networkInformation.chainId)
    );
  }
  /**
  * Get current `median_gas_price`
  * @returns Current `median_gas_price`
  * @example
  * ```typescript
  * import { SupraClient,Network } from "supra-ts-sdk";
  * 
  * const supra = new SupraClient({ network: Network.TESTNET });
  * 
  * async function runExample() {
  *    const gasPrice = await supra.getGasPrice();
  *    console.log(gasPrice);
  * }
  * 
  * runExample().catch(console.error);
  * ```
  * @group SupraClient
  */
  async getGasPrice() {
    return getGasPriceInternal(this.networkInformation);
  }
  /**
   * Get current `min_price_per_gas_unit`
   * @returns Current `min_price_per_gas_unit`
   * @example
   * ```typescript
   * import { SupraClient,Network } from "supra-ts-sdk";
   * 
   * const supra = new SupraClient({ network: Network.TESTNET });
   * 
   * async function runExample() {
   *    const gasPrice = await supra.getMinGasUnitPrice();
   *    console.log(gasPrice);
   * }
   * runExample().catch(console.error);
   * 
   * ```
   * @group SupraClient
   */
  async getMinGasUnitPrice() {
    return getMinGasUnitPriceInternal(this.networkInformation);
  }
};
function applyMixins(derivedCtor, constructors) {
  constructors.forEach((baseCtor) => {
    Object.getOwnPropertyNames(baseCtor.prototype).forEach((name) => {
      Object.defineProperty(
        derivedCtor.prototype,
        name,
        Object.getOwnPropertyDescriptor(baseCtor.prototype, name) || /* @__PURE__ */ Object.create(null)
      );
    });
  });
}
applyMixins(SupraClient, [Account, Transaction, Contract, Methods, Faucet, Table, Coin, Events, Block, FungibleAsset]);

// src/types/move.ts
import "supra-l1-sdk-core";

// src/errors/moveVmErrors.ts
var MoveVmError = /* @__PURE__ */ ((MoveVmError2) => {
  MoveVmError2["EXECUTED"] = "EXECUTED";
  MoveVmError2["OUT_OF_GAS"] = "OUT_OF_GAS";
  MoveVmError2["SEQUENCE_NUMBER_TOO_OLD"] = "SEQUENCE_NUMBER_TOO_OLD";
  MoveVmError2["SEQUENCE_NUMBER_TOO_NEW"] = "SEQUENCE_NUMBER_TOO_NEW";
  MoveVmError2["INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE"] = "INSUFFICIENT_BALANCE_FOR_TRANSACTION_FEE";
  MoveVmError2["TRANSACTION_EXPIRED"] = "TRANSACTION_EXPIRED";
  MoveVmError2["SENDING_ACCOUNT_DOES_NOT_EXIST"] = "SENDING_ACCOUNT_DOES_NOT_EXIST";
  MoveVmError2["SENDING_ACCOUNT_FROZEN"] = "SENDING_ACCOUNT_FROZEN";
  MoveVmError2["UNKNOWN_VALIDATION_STATUS"] = "UNKNOWN_VALIDATION_STATUS";
  MoveVmError2["EXCEEDED_MAX_TRANSACTION_SIZE"] = "EXCEEDED_MAX_TRANSACTION_SIZE";
  MoveVmError2["LINKER_ERROR"] = "LINKER_ERROR";
  MoveVmError2["FUNCTION_RESOLUTION_FAILURE"] = "FUNCTION_RESOLUTION_FAILURE";
  MoveVmError2["TYPE_MISMATCH"] = "TYPE_MISMATCH";
  MoveVmError2["MOVE_ABORT"] = "MOVE_ABORT";
  MoveVmError2["ARITHMETIC_ERROR"] = "ARITHMETIC_ERROR";
  MoveVmError2["EXECUTION_STACK_OVERFLOW"] = "EXECUTION_STACK_OVERFLOW";
  MoveVmError2["MEMORY_LIMIT_EXCEEDED"] = "MEMORY_LIMIT_EXCEEDED";
  return MoveVmError2;
})(MoveVmError || {});
function isMoveVmError(status) {
  if (!status) return false;
  return Object.values(MoveVmError).includes(status);
}

// src/index.ts
import { BCS as BCS12, HexString as HexString8, SupraAccount as SupraAccount5, TxnBuilderTypes as TxnBuilderTypes11 } from "supra-l1-sdk-core";
export {
  Account,
  BCS12 as BCS,
  Block,
  Build,
  Coin,
  Contract,
  DEFAULT_CHAIN_ID,
  DEFAULT_ENABLE_SIMULATION,
  DEFAULT_GAS_PRICE,
  DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_EXISTS,
  DEFAULT_MAX_GAS_FOR_SUPRA_TRANSFER_WHEN_RECEIVER_NOT_EXISTS,
  DEFAULT_MAX_GAS_UNITS,
  DEFAULT_RECORDS_ITEMS_COUNT,
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_RPC_VERSION,
  DEFAULT_TXN_TIMEOUT_SEC,
  DEFAULT_TX_EXPIRATION_DURATION,
  DEFAULT_WAIT_FOR_TX_COMPLETION,
  DELAY_BETWEEN_POOLING_REQUEST,
  Events,
  Faucet,
  FungibleAsset,
  HexString8 as HexString,
  MAX_RETRY_FOR_TRANSACTION_COMPLETION,
  MILLISECONDS_PER_SECOND,
  Methods,
  MoveVmError,
  Network,
  NetworkInfo,
  OBJECT_CORE,
  RAW_TRANSACTION_SALT,
  RAW_TRANSACTION_WITH_DATA_SALT,
  SUPRA_COIN_TYPE,
  SUPRA_FRAMEWORK_ADDRESS,
  Simulate,
  Submit,
  SupraAPIError,
  SupraAccount5 as SupraAccount,
  SupraClient,
  Table,
  Transaction,
  TransactionStatus,
  TransactionType,
  TxnBuilderTypes11 as TxnBuilderTypes,
  addAddressPadding,
  getFunctionParts,
  isMoveVmError,
  standardizeAddress
};
//# sourceMappingURL=index.js.map