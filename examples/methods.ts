import { SupraClient, Network } from '../src/index';
import { TypeTagParser } from 'supra-l1-sdk-core';
import { MoveValue } from '../src/types/move';
import { isMoveStruct } from '../src/helper/general';

(async () => {
    const supra = new SupraClient({ network: Network.TESTNET });
    let accountAddress = "0x0000000000000000000000000000000000000000000000000000000000000001";

    // ---------------------------------------------------------------------------
    // Query the account balance of a specific coin with typed view function
    // example:
    // string : "hello world"
    // address : "0x2ee12e63209aee603c76e94e6fbb509629ec2617a65a858da62d862ad2818bc5"
    // u8, u16, u32 : 10
    // u64, u128, u256 : 100n
    // vector<u8> : "10"
    // vector<u16> : [1,2,3]
    // vector<u256> :[100n]
    // vector<address> : ["0x2ee12e63209aee603c76e94e6fbb509629ec2617a65a858da62d862ad2818bc5"]
    // Option<u8> : "10"
    // Option<u16> : 10
    // Option<u32> : 10
    // Option<u64>: 100n
    // Option<u256>: 100n
    // Option<null> : null
    // Option<vector<u8>> : "10"
    // Option<vector<32>> : [100]
    // Option<vector<u256>> : [100n]
    // ---------------------------------------------------------------------------

    let supraCoin = new TypeTagParser("0x1::supra_coin::SupraCoin").parseTypeTag();

    const accountSupraBalance = await supra.methods.view<[bigint]>({
        function: "0x1::coin::balance",
        functionArguments: ["0x2ee12e63209aee603c76e94e6fbb509629ec2617a65a858da62d862ad2818bc5"],
        typeArguments: [supraCoin]
    });

    console.log("Account supra balance:", accountSupraBalance[0]);


    // ---------------------------------------------------------------------------
    // Query the account balance of a specific coin with raw view function
    // example:
    // string : "hello world"
    // address : "0x2ee12e63209aee603c76e94e6fbb509629ec2617a65a858da62d862ad2818bc5"
    // u8, u16, u32 : 10
    // u64, u128, u256 : "100"
    // vector<u8> : "10",
    // vector<u16> : [1,2,3],
    // vector<u256> : ["1","2","3"],
    // vector<address> : ["0x2ee12e63209aee603c76e94e6fbb509629ec2617a65a858da62d862ad2818bc5"]
    // Option<u8> : {"vec" : "10"}
    // Option<u16> : {"vec" : [100]}
    // Option<u32> : {"vec" : [100]}
    // Option<u64>: {"vec" : ["100"]}
    // Option<u256>: {"vec" : ["100"]}
    // Option<null> : { "vec" : [] } 
    // Option<vector<u8>> : { "vec": ["10"] }
    // Option<vector<32>> : { "vec": [[100]] }
    // Option<vector<u256>> : { "vec": [["100"]] }
    // ---------------------------------------------------------------------------

    const accountSupraBalanceRaw = await supra.methods.viewRaw({
        function: "0x1::coin::balance",
        functionArguments: ["0x2ee12e63209aee603c76e94e6fbb509629ec2617a65a858da62d862ad2818bc5"],
        typeArguments: ["0x1::supra_coin::SupraCoin"]
    });


    console.log("Account supra balance raw:", accountSupraBalanceRaw[0]);
    






})();