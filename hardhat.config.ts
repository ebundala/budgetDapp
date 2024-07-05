import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-ethers";
import "@openzeppelin/hardhat-upgrades";
import dotenv from "dotenv"
dotenv.config();
const config: HardhatUserConfig = {
//  solidity: "0.8.24",
defaultNetwork:"hardhat",
  networks: {
    hardhat: {
    },
    // sepolia: {
    //   url: "https://sepolia.infura.io/v3/<key>",
    //   accounts: [process.env.BUDGET_ACCOUNT!]
    // }
    testnet: {
      url: "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      gasPrice: 20000000000,
      accounts: [process.env.BUDGET_ACCOUNT!]
    },
    mainnet: {
      url: "https://bsc-dataseed.binance.org/",
      chainId: 56,
      gasPrice: 20000000000,
      accounts: [process.env.BUDGET_ACCOUNT!]
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  sourcify: {
    enabled: true
  },
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200
      }
    }
  },
};

export default config;
