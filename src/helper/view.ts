import { getAccountModuleInternal } from "../internal/account";
import type { InputViewFunctionData } from "../types/methods";

import type { NetworkConfig } from "../utils/apiEndpoints";
import { getFunctionABI } from "./abi";
import {
    convertPayloadArgsToJSONParsable,
    convertPayloadTypeArgsToJSONParsable,
    getFunctionParts,
    typeArgumentTypeStrings,
} from "./general";

/**
 * Generate a payload for a view function. The arguments are converted as their parameter types with the type
 * parameters replaced by the type arguments. `typeArgumentTypes` holds the type arguments as Move type strings, to
 * convert the results the same way (`convertValueToAbiReturnTypedValue`).
 */
export async function generateViewFunctionPayload(args: InputViewFunctionData, config: NetworkConfig) {
    let { moduleAddress, moduleName, functionName } = getFunctionParts(args.function);

    const abi =
        args.abi ??
        (await getAccountModuleInternal({ accountAddress: moduleAddress!, moduleName: moduleName! }, config)).abi!;

    let funcABI = await getFunctionABI(abi, moduleAddress!, moduleName!, functionName!);

    // Convert type arguments to JSON parsable
    let parsableTypeArguments = convertPayloadTypeArgsToJSONParsable(funcABI, args);

    // Convert arguments to JSON parsable
    let parsableArguments = convertPayloadArgsToJSONParsable(funcABI, args);

    return {
        function: args.function,
        typeArguments: parsableTypeArguments ?? [],
        functionArguments: parsableArguments,
        returnType: funcABI.return,
        typeArgumentTypes: typeArgumentTypeStrings(args.typeArguments),
    };
}
