import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import hre from "hardhat";
import { parseEther } from "ethers";
import { Budgetly__factory, BudgetToken__factory } from "../typechain-types";
describe("Budget contract", () => {
  async function deployContracts() {
    const provider = hre.ethers.provider;
    const budgetFactory = await hre.ethers.getContractFactory("Budgetly");
    const budgetToken = await hre.ethers.deployContract("BudgetToken");
    const budgetToken1 = await hre.ethers.deployContract("BudgetToken");
    const budgetToken2 = await hre.ethers.deployContract("BudgetToken");
    const budgetContract = await hre.upgrades.deployProxy(budgetFactory, {
      kind: "uups",
    });
    const budgetContractAddress = await budgetContract.getAddress();
    const signer = await provider.getSigner();
    const userAddress = await signer.getAddress();
    const tokenAddress = await budgetToken.getAddress();
    const tokenAddress1 = await budgetToken1.getAddress();
    const tokenAddress2 = await budgetToken2.getAddress();
    const amount = parseEther("100");
    //set allowance
    await budgetToken.approve(budgetContractAddress, amount);
    await budgetToken1.approve(budgetContractAddress, amount);
    await budgetToken2.approve(budgetContractAddress, amount);

    //whitelist tokens
    await budgetContract.whitelistToken(tokenAddress, true);
    await budgetContract.whitelistToken(tokenAddress1, true);
    await budgetContract.whitelistToken(tokenAddress2, false);
    const budgetName = hre.ethers.encodeBytes32String("testBudget");

    const balance = await budgetToken.balanceOf(userAddress);
    expect(balance === parseEther("100")).equal(true);
    const balance1 = await budgetToken1.balanceOf(userAddress);
    expect(balance1 === parseEther("100")).equal(true);
    const balance2 = await budgetToken2.balanceOf(userAddress);
    expect(balance2 === parseEther("100")).equal(true);

    const blockTimestamp = async () => {
      return await BigInt((await provider.getBlock("latest"))!.timestamp);
    };
    return {
      provider,
      signer,
      userAddress,
      budgetFactory,
      budgetToken: BudgetToken__factory.connect(tokenAddress, signer),
      budgetToken1: BudgetToken__factory.connect(tokenAddress1, signer),
      budgetToken2: BudgetToken__factory.connect(tokenAddress2, signer),
      budgetContract: Budgetly__factory.connect(budgetContractAddress, signer),
      tokenAddress,
      tokenAddress1,
      tokenAddress2,
      budgetContractAddress,
      budgetName,
      blockTimestamp,
    };
  }
  it("should whitelist token", async () => {
    const { budgetContract, tokenAddress2 } = await loadFixture(
      deployContracts
    );
    await budgetContract.whitelistToken(tokenAddress2, true);
  });
  it("Should blacklist token", async () => {
    const { budgetContract, tokenAddress2 } = await loadFixture(
      deployContracts
    );
    await budgetContract.whitelistToken(tokenAddress2, false);
  });

  it("Should fail to lock non whitelisted token", async () => {
    const { budgetContract, tokenAddress2, blockTimestamp, budgetName } =
      await loadFixture(deployContracts);
    const amount = hre.ethers.parseEther("23");
    const releaseAmount = hre.ethers.parseEther("5");
    const cycle = BigInt(200);

    //test locking non whitelisted token
    let timestamp = await blockTimestamp();
    const startDelta = 100;
    await expect(
      budgetContract.lockFunds(
        budgetName,
        [tokenAddress2],
        [amount],
        cycle,
        timestamp + BigInt(startDelta),
        releaseAmount
      )
    ).to.be.revertedWith("Token is not whitelisted");
  });

  it("Should lock single whitelisted token", async () => {
    const {
      budgetContract,
      budgetToken,
      tokenAddress,
      blockTimestamp,
      userAddress,
      budgetName,
    } = await loadFixture(deployContracts);
    const amount = hre.ethers.parseEther("23");
    const releaseAmount = hre.ethers.parseEther("5");
    const cycle = BigInt(200);
    let timestamp = await blockTimestamp();
    const startDelta = 100;
    await time.increaseTo(BigInt((await timestamp) + BigInt(startDelta)));
    let availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("0")).to.equal(availableBalance);

    //test single whitelisted token
    timestamp = await blockTimestamp();
    await budgetContract.lockFunds(
      budgetName,
      [tokenAddress],
      [amount],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    );
    await time.increaseTo(BigInt((await timestamp) + BigInt(startDelta)));
    timestamp = await blockTimestamp();
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("0")).to.equal(availableBalance);

    await time.increaseTo(timestamp + cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount).to.equal(availableBalance);

    timestamp = await blockTimestamp();
    await time.increaseTo(timestamp + cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount + releaseAmount).to.equal(availableBalance);

    timestamp = await blockTimestamp();
    await time.increaseTo(timestamp + cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(availableBalance).to.equal(
      releaseAmount + releaseAmount + releaseAmount
    );

    timestamp = await blockTimestamp();
    await time.increaseTo(timestamp + cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(availableBalance).to.equal(
      releaseAmount + releaseAmount + releaseAmount + releaseAmount
    );
    //should handle balances correctly even if the balance is not divisible by number of cycle
    timestamp = await blockTimestamp();
    await time.increaseTo(timestamp + cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(availableBalance).to.equal(
      releaseAmount +
        releaseAmount +
        releaseAmount +
        releaseAmount +
        parseEther("3")
    );

    const _balance = await budgetToken.balanceOf(userAddress);
    expect(_balance === parseEther("77")).equal(true);
  });

  it("Should lock multiple whitelisted token", async () => {
    const {
      budgetContract,
      budgetToken,
      tokenAddress,
      tokenAddress1,
      blockTimestamp,
      budgetName,
      userAddress,
    } = await loadFixture(deployContracts);
    const amount = hre.ethers.parseEther("11");
    const releaseAmount = hre.ethers.parseEther("5");
    const cycle = BigInt(200);
    let timestamp = await blockTimestamp();
    const startDelta = 100;
    await time.increaseTo(BigInt((await timestamp) + BigInt(startDelta)));
    let availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("0")).to.equal(availableBalance);

    timestamp = await blockTimestamp();
    await budgetContract.lockFunds(
      budgetName,
      [tokenAddress, tokenAddress1],
      [amount, amount + parseEther("1")],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    );
    await time.increaseTo(BigInt((await timestamp) + BigInt(startDelta)));
    timestamp = await blockTimestamp();
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("0")).to.equal(availableBalance);

    await time.increaseTo(timestamp + cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount).to.equal(availableBalance);

    timestamp = await blockTimestamp();
    await time.increaseTo(timestamp + cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount + releaseAmount).to.equal(availableBalance);

    timestamp = await blockTimestamp();
    await time.increaseTo(timestamp + cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(availableBalance).to.equal(
      releaseAmount + releaseAmount + releaseAmount
    );

    timestamp = await blockTimestamp();
    await time.increaseTo(timestamp + cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(availableBalance).to.equal(
      releaseAmount + releaseAmount + releaseAmount + releaseAmount
    );
    //should handle balances correctly even if the balance is not divisible by number of cycle
    timestamp = await blockTimestamp();
    await time.increaseTo(timestamp + cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(availableBalance).to.equal(
      releaseAmount +
        releaseAmount +
        releaseAmount +
        releaseAmount +
        parseEther("3")
    );

    const _balance = await budgetToken.balanceOf(userAddress);
    expect(_balance === parseEther("77")).equal(true);
  });
  it("Should get single token budget details", async () => {
    const {
      budgetContract,
      tokenAddress,
      blockTimestamp,
      budgetName,
    } = await loadFixture(deployContracts);
    const amount = hre.ethers.parseEther("23");
    const releaseAmount = hre.ethers.parseEther("5");
    const cycle = BigInt(200);
    let timestamp = await blockTimestamp();
    const startDelta = 100;
    await time.increaseTo(BigInt((await timestamp) + BigInt(startDelta)));
    let availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("0")).to.equal(availableBalance);

    //test single whitelisted token
    timestamp = await blockTimestamp();
    await budgetContract.lockFunds(
      budgetName,
      [tokenAddress],
      [amount],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    );
    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle);

    const details = await budgetContract.getBudgetDetails(budgetName);

    expect(details.tokens[0]).equal(tokenAddress);
    expect(details.balances[0]).equal(amount);
    expect(details.releaseCycle).equal(cycle);
    expect(details.releaseAmount).equal(releaseAmount);
    expect(details.lastReleaseTime).equal(await blockTimestamp());
  });

  it("Should get multiple token budget details", async () => {
    const {
      budgetContract,
      tokenAddress,
      tokenAddress1,
      blockTimestamp,
      budgetName,
    } = await loadFixture(deployContracts);
    const amount = hre.ethers.parseEther("11");
    const releaseAmount = hre.ethers.parseEther("5");
    const cycle = BigInt(200);
    let timestamp = await blockTimestamp();
    const startDelta = 100;
    await time.increaseTo(BigInt((await timestamp) + BigInt(startDelta)));
    let availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("0")).to.equal(availableBalance);

    //test single whitelisted token
    timestamp = await blockTimestamp();
    await budgetContract.lockFunds(
      budgetName,
      [tokenAddress,tokenAddress1],
      [amount,amount+parseEther("1")],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    );
    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle);

    const details = await budgetContract.getBudgetDetails(budgetName);

    expect(details.tokens[0]).equal(tokenAddress);
    expect(details.balances[0]).equal(amount);
    expect(details.tokens[1]).equal(tokenAddress1);
    expect(details.balances[1]).equal(amount+parseEther("1"));
    expect(details.releaseCycle).equal(cycle);
    expect(details.releaseAmount).equal(releaseAmount);
    expect(details.lastReleaseTime).equal(await blockTimestamp());
  });
  it("Should handle balances correctly for single token(leftovers)",async()=>{
    const {
      budgetContract,
      tokenAddress,
      blockTimestamp,
      budgetName,
    } = await loadFixture(deployContracts);
    const amount = hre.ethers.parseEther("23");
    const releaseAmount = hre.ethers.parseEther("5");
    const cycle = BigInt(200);
    let timestamp = await blockTimestamp();
    const startDelta = 100;
    await time.increaseTo(BigInt((await timestamp) + BigInt(startDelta)));
    let availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("0")).to.equal(availableBalance);

    timestamp = await blockTimestamp();
    await budgetContract.lockFunds(
      budgetName,
      [tokenAddress],
      [amount],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    );
    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle+cycle+cycle+cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("23")).to.equal(availableBalance);
  });
  it("Should handle balances for multiple token correctly (leftovers)", async () => {
    const {
      budgetContract,
      tokenAddress,
      tokenAddress1,
      blockTimestamp,
      budgetName,
    } = await loadFixture(deployContracts);
    const amount = hre.ethers.parseEther("11");
    const releaseAmount = hre.ethers.parseEther("5");
    const cycle = BigInt(200);
    let timestamp = await blockTimestamp();
    const startDelta = 100;
    await time.increaseTo(BigInt((await timestamp) + BigInt(startDelta)));
    let availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("0")).to.equal(availableBalance);

    //test single whitelisted token
    timestamp = await blockTimestamp();
    await budgetContract.lockFunds(
      budgetName,
      [tokenAddress,tokenAddress1],
      [amount,amount+parseEther("1")],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    );
    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle+cycle+cycle+cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("23")).to.equal(availableBalance);
  });

  it("Should release blacklisted token", async () => {
    const {
      budgetContract,
      tokenAddress2,
      blockTimestamp,
      budgetName,
      userAddress,
      budgetToken2,
      budgetContractAddress
    } = await loadFixture(deployContracts);
    const amount = hre.ethers.parseEther("23");
    const releaseAmount = hre.ethers.parseEther("5");
    const cycle = BigInt(200);
    let timestamp = await blockTimestamp();
    const startDelta = 100;
    await time.increaseTo(BigInt((await timestamp) + BigInt(startDelta)));
    let availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("0")).to.equal(availableBalance);

    timestamp = await blockTimestamp();
    await budgetContract.whitelistToken(tokenAddress2,true)
    await budgetContract.lockFunds(
      budgetName,
      [tokenAddress2],
      [amount],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    );
   // timestamp = await blockTimestamp()
    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle);
     availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount+releaseAmount).to.equal(availableBalance);
    await budgetContract.whitelistToken(tokenAddress2,false)
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("23")).to.equal(availableBalance);

    await budgetContract.releaseFunds(budgetName,userAddress)
    await expect(budgetToken2.balanceOf(budgetContractAddress)).to.be.equal(parseEther("13"))
    await expect(budgetToken2.balanceOf(userAddress)).to.be.equal(parseEther("87"))

    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle);
    await budgetContract.releaseFunds(budgetName,userAddress)
    await expect(budgetToken2.balanceOf(budgetContractAddress)).to.be.equal(parseEther("0"))
    await expect(budgetToken2.balanceOf(userAddress)).to.be.equal(parseEther("100"))

  })
  it("Should release one whitelisted token", async () => {
    const {
      budgetContract,
      tokenAddress,
      blockTimestamp,
      budgetName,
      userAddress,
      budgetToken,
      budgetContractAddress
    } = await loadFixture(deployContracts);
    const amount = hre.ethers.parseEther("23");
    const releaseAmount = hre.ethers.parseEther("5");
    const cycle = BigInt(200);
    let timestamp = await blockTimestamp();
    const startDelta = 100;
    await time.increaseTo(BigInt((await timestamp) + BigInt(startDelta)));
    let availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("0")).to.equal(availableBalance);

    timestamp = await blockTimestamp();
    await budgetContract.lockFunds(
      budgetName,
      [tokenAddress],
      [amount],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    );
   // timestamp = await blockTimestamp()
    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle);
     availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount+releaseAmount).to.equal(availableBalance);
    await budgetContract.whitelistToken(tokenAddress,false)
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("23")).to.equal(availableBalance);

    await budgetContract.releaseFunds(budgetName,userAddress)
    await expect(budgetToken.balanceOf(budgetContractAddress)).to.be.equal(parseEther("13"))
    await expect(budgetToken.balanceOf(userAddress)).to.be.equal(parseEther("87"))

    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle);
    await budgetContract.releaseFunds(budgetName,userAddress)
    await expect(budgetToken.balanceOf(budgetContractAddress)).to.be.equal(parseEther("0"))
    await expect(budgetToken.balanceOf(userAddress)).to.be.equal(parseEther("100"))
  });
  it("Should release multiple whitelisted token ", async () => {
    const {
      budgetContract,
      tokenAddress,
      blockTimestamp,
      budgetName,
      userAddress,
      budgetToken,
      budgetContractAddress
    } = await loadFixture(deployContracts);
    const amount = hre.ethers.parseEther("23");
    const releaseAmount = hre.ethers.parseEther("5");
    const cycle = BigInt(200);
    let timestamp = await blockTimestamp();
    const startDelta = 100;
    await time.increaseTo(BigInt((await timestamp) + BigInt(startDelta)));
    let availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("0")).to.equal(availableBalance);

    timestamp = await blockTimestamp();
    await budgetContract.lockFunds(
      budgetName,
      [tokenAddress],
      [amount],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    );
   // timestamp = await blockTimestamp()
    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle);
     availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount+releaseAmount).to.equal(availableBalance);
    await budgetContract.whitelistToken(tokenAddress,false)
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("23")).to.equal(availableBalance);

    await budgetContract.releaseFunds(budgetName,userAddress)
    await expect(budgetToken.balanceOf(budgetContractAddress)).to.be.equal(parseEther("13"))
    await expect(budgetToken.balanceOf(userAddress)).to.be.equal(parseEther("87"))

    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle);
    await budgetContract.releaseFunds(budgetName,userAddress)
    await expect(budgetToken.balanceOf(budgetContractAddress)).to.be.equal(parseEther("0"))
    await expect(budgetToken.balanceOf(userAddress)).to.be.equal(parseEther("100"))
  });



  it("Should update release amount of whitelisted token", async () => {});
  it("Should update release amount of multiple whiteliste token", async () => {});
  it("Should top up single whitelisted token", async () => {});
  it("Should top up multiple whitelisted token", async () => {});
  it("Should update release cycle of whitelisted token", async () => {});
  it("Should update release cycle of multiple whiteliste token", async () => {});
  it("Should get total balance corretly", async () => {});
  it("Should get available balances corectly", async () => {});

  it("Lock funds", async () => {
    const {
      budgetContract,
      tokenAddress,
      budgetName,
    } = await loadFixture(deployContracts);

    const amount = hre.ethers.parseEther("23");
    const releaseAmount = hre.ethers.parseEther("5");
    const cycle = BigInt(200);

    // const _balance1 = await budgetToken1.balanceOf(userAddress);
    // expect(_balance1 === parseEther("90")).equal(true);
    // const _balance2 = await budgetToken2.balanceOf(userAddress);
    // expect(_balance2 === parseEther("90")).equal(true);

    const details = await budgetContract.getBudgetDetails(budgetName);
    expect(details.tokens[0]).equal(tokenAddress);
    expect(details.balances[0]).equal(amount);
    expect(details.releaseCycle).equal(cycle);
    expect(details.releaseAmount).equal(releaseAmount);

    // done();
  });

  /*   it("Release funds",async ()=>{
    const fixtures = await loadFixture(deployContracts);
    expect(false).equal(true)
  })

  it("Update release amount",async ()=>{
    const fixtures = await loadFixture(deployContracts);
    expect(false).equal(true)
  })

  it("Lock funds multiple token",async ()=>{
    const fixtures = await loadFixture(deployContracts);
    expect(false).equal(true)
  })

  it("Release funds multiple token",async ()=>{
    const fixtures = await loadFixture(deployContracts);
    expect(false).equal(true)
  })

  it("Update release amount multiple token",async ()=>{
    const fixtures = await loadFixture(deployContracts);
    expect(false).equal(true)
  }) */
});
