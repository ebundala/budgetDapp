import hre from "hardhat";

async function main() {
    const provider = hre.ethers.provider;
    const budgetFactory = await hre.ethers.getContractFactory("Budgetly");
   // const budgetToken = await hre.ethers.deployContract("BudgetToken");
    // const budgetToken1 = await hre.ethers.deployContract("BudgetToken");
    // const budgetToken2 = await hre.ethers.deployContract("BudgetToken");
    let budgetContract = await hre.upgrades.deployProxy(budgetFactory, {
      kind: "uups",
    });
    budgetContract = await budgetContract.waitForDeployment()
    const budgetContractAddress = await budgetContract.getAddress();
  //  const tokenAddress = await budgetToken.getAddress();
    console.log(`Budgetly: ${budgetContractAddress}`)
   // console.log(`Token: ${tokenAddress}`)
}

main().catch(console.error);