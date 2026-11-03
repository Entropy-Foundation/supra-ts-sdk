import { getAccountModuleInternal } from "../internal/account";
import type { InputViewFunctionData } from "../types/methods";

import type { NetworkConfig } from "../utils/apiEndpoints";
import { getFunctionABI } from "./abi";
import {
    convertPayloadArgsToJSONParsable,
    convertPayloadTypeArgsToJSONParsable,
    getFunctionParts,
    typeArgumentReadAsAddress,
    typeArgumentTypeStrings,
} from "./general";

/**
 * Generate a payload for a view function. The arguments are converted as their parameter types with the type
 * parameters replaced by the type arguments. `typeArgumentTypes` holds the type arguments as Move type strings, to
 * convert the results the same way (`convertValueToAbiReturnTypedValue`). `typeArgumentNeedingV12` is the first type
 * argument that a node before `supra_node_v12.0.0` would read as an `address` (`typeArgumentReadAsAddress`), or
 * `undefined`.
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

    const typeArgumentTypes = typeArgumentTypeStrings(args.typeArguments);

    return {
        function: args.function,
        typeArguments: parsableTypeArguments ?? [],
        functionArguments: parsableArguments,
        returnType: funcABI.return,
        typeArgumentTypes,
        typeArgumentNeedingV12: typeArgumentReadAsAddress([...funcABI.params, ...funcABI.return], typeArgumentTypes),
    };
}
