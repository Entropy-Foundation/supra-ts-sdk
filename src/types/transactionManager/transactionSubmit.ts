import type { OptionalTransactionPayloadArgs } from "./transactionBuild";

export interface EnableTransactionWaitAndSimulationArgs {
    enableWaitForTransaction?: boolean;
    enableTransactionSimulation?: boolean;
}

export interface OptionalTransactionArgs {
    optionalTransactionPayloadArgs?: OptionalTransactionPayloadArgs;
    enableTransactionWaitAndSimulationArgs?: EnableTransactionWaitAndSimulationArgs;
}