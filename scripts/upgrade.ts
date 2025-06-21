import hre from "hardhat";

async function main() {
    const provider = hre.ethers.provider;
    const budgetFactory = await hre.ethers.getContractFactory("Budgetly");
    const ADDRESS="0xF655290831992c2725CbBe75213C476D185c0bF9"; // Replace with your deployed contract address
    let budgetContract = await hre.upgrades.upgradeProxy(ADDRESS,budgetFactory, {
      kind: "uups",
    });
    
    console.log(`Budgetly: upgraded`)
   // console.log(`Token: ${tokenAddress}`)
}

main().catch(console.error);