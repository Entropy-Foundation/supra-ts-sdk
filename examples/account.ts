import { SupraClient, Network } from '../src/index';
import { HexString } from 'supra-l1-sdk-core';

(async () => {
    const supra = new SupraClient({ network: Network.TESTNET });

    // -------------------------------------------------------------------------
    // Query the current state of an account
    // -------------------------------------------------------------------------
    const accountAddress1 = "0x88fbd33f54e1126269769780feb24480428179f552e2313fbe571b72e62a1c55";
    const accountData1 = await supra.account.isAccountExists({ accountAddress: accountAddress1 });

    console.log("Account exists:", accountData1);

    // -------------------------------------------------------------------------
    // Query the current state of an account
    // -------------------------------------------------------------------------
    let accountAddress = "0x0000000000000000000000000000000000000000000000000000000000000001";
    const accountData = await supra.account.getAccountInfo({ accountAddress: accountAddress });

    console.log("Account data:", accountData);

    // -------------------------------------------------------------------------
    // Query the current state of an account
    // -------------------------------------------------------------------------
    let hexAccountAddress = new HexString("0x0000000000000000000000000000000000000000000000000000000000000001");
    const accountData2 = await supra.account.getAccountInfo({ accountAddress: hexAccountAddress });

    console.log("Account data:", accountData2);


    // -------------------------------------------------------------------------
    // Query the modules of an account
    // -------------------------------------------------------------------------
    const { response: accountModules } = await supra.account.getAccountModules({ accountAddress: accountAddress });

    console.log("Account modules:", accountModules);


    // -------------------------------------------------------------------------
    // Query the specific module of an account
    // -------------------------------------------------------------------------
    const accountModule = await supra.account.getAccountModule({ accountAddress: hexAccountAddress, moduleName: "acl" });

    console.log("Account module:", accountModule);


    // --------------------------------------------------------------------------
    // Query the resources of an account
    // -------------------------------------------------------------------------
    const { response: accountResources } = await supra.account.getAccountResources({ accountAddress: accountAddress });

    console.log("Account resources:", accountResources);


    // --------------------------------------------------------------------------
    // Query the specific resource of an account
    // -------------------------------------------------------------------------
    const accountResource = await supra.account.getAccountResource({ accountAddress: accountAddress, resourceType: "0x1::coin::CoinStore<0x1::supra_coin::SupraCoin>" });

    console.log("Account resource:", accountResource);


    // --------------------------------------------------------------------------
    // Query the specific resource of an account
    // -------------------------------------------------------------------------

    const { response: accountTransactions } = await supra.account.getAccountTransactions({ accountAddress: "0x665f6c5e407321321bb411711fc42eb43ad46e9964c17096c92cb72e734e928a", options: { count: 1 } });

    console.log("Account transaction:", accountTransactions[0]);

    // --------------------------------------------------------------------------
    // Query the legacy token count of an account
    // -------------------------------------------------------------------------

    const accountCoinsCount = await supra.account.getAccountCoinsCount({ accountAddress: "0x10cdf6e0c4c5c762bb23be3eac5c7eaa272c1b4abe0573cd1386c5632b7992ca" });

    console.log("Account coins count:", accountCoinsCount);

    // --------------------------------------------------------------------------
    // Query the legacy tokens of an account
    // -------------------------------------------------------------------------
    const { response: accountCoinTransaction } = await supra.account.getAccountCoinTransactions({ accountAddress: "0x10cdf6e0c4c5c762bb23be3eac5c7eaa272c1b4abe0573cd1386c5632b7992ca" });

    console.log("Account coin transaction:", accountCoinTransaction);


    // --------------------------------------------------------------------------
    // Query the auto transactions of an account
    // -------------------------------------------------------------------------
    const { response: accountAutoTransaction, cursor } = await supra.account.getAccountAutoTransactions({ accountAddress: "0xfd1c16e536bf78e79b3f0c22d10a7fb850a0270e1c638eb184d251c37ef87039", options: { count: 10 } });

    console.log("Account auto transaction:", accountAutoTransaction);


    // ---------------------------------------------------------------------------
    // Query the supra coin balance of an account
    // ---------------------------------------------------------------------------

    let supraBalance = await supra.account.getAccountSupraCoinBalance({
        accountAddress: "0x10cdf6e0c4c5c762bb23be3eac5c7eaa272c1b4abe0573cd1386c5632b7992ca"
    });

    console.log("Supra balance:", supraBalance);

    // ---------------------------------------------------------------------------
    // Query the coin balance of an account
    // ---------------------------------------------------------------------------

    let supraBalanceLegacy = await supra.account.getAccountCoinBalance({
        accountAddress: "0x10cdf6e0c4c5c762bb23be3eac5c7eaa272c1b4abe0573cd1386c5632b7992ca",
        asset: "0x1::supra_coin::SupraCoin"
    });


    let supraBalanceFungible = await supra.account.getAccountCoinBalance({
        accountAddress: "0x10cdf6e0c4c5c762bb23be3eac5c7eaa272c1b4abe0573cd1386c5632b7992ca",
        asset: "0xa"
    });


    console.log("Supra balance legacy:", supraBalanceLegacy);
    console.log("Supra balance fungible:", supraBalanceFungible);


})();