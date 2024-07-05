import hre from "hardhat";
import { parseEther } from "ethers";
async function main() {
    const provider = hre.ethers.provider;
    const budgetFactory = await hre.ethers.getContractFactory("Budgetly");
   const budgetName = hre.ethers.encodeBytes32String("Main budget");
   const amount = parseEther("61.36")
  //  const tokenAddress = await budgetToken.getAddress();
    console.log(`Budgetly name: ${budgetName} \n amount ${amount}`)
   // console.log(`Token: ${tokenAddress}`)
}

main().catch(console.error);