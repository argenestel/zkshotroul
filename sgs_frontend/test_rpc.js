import { rpc, xdr, Address } from "@stellar/stellar-sdk";

async function test() {
  const server = new rpc.Server("https://soroban-testnet.stellar.org");
  const contractId = "CBB2W6PK2UBPKSXCXG2S2R3VOS4ISV5HLJVFKNDMOUG6KABPJJ5JCJGJ";
  const sessionId = 1;
  const sessionVal = xdr.ScVal.scvU32(sessionId);
  const seedKey = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol('CombinedSeed'),
    sessionVal,
  ]);
  const contractAddress = new Address(contractId);
  const ledgerKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: contractAddress.toScAddress(),
      key: seedKey,
      durability: xdr.ContractDataDurability.temporary(),
    })
  );
  try {
    const res = await server.getLedgerEntries(ledgerKey);
    console.log("Success:", res);
  } catch (e) {
    console.error("Error:", e);
  }
}
test();
