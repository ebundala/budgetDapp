import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
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
    await expect(budgetContract.whitelistToken(tokenAddress2, true)).to.emit(budgetContract,"TokenStatusChanged");
  });
  it("Should blacklist token", async () => {
    const { budgetContract, tokenAddress2 } = await loadFixture(
      deployContracts
    );
    await expect(budgetContract.whitelistToken(tokenAddress2, false)).to.emit(budgetContract,"TokenStatusChanged");
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
      budgetContractAddress,
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
    await expect(budgetContract.lockFunds(
      budgetName,
      [tokenAddress],
      [amount],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    )).to.emit(budgetContract,"BudgetCreated");
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

    let _balance = await budgetToken.balanceOf(userAddress);
    expect(_balance).to.be.equal(parseEther("77"));
    _balance = await budgetToken.balanceOf(budgetContractAddress);
    expect(_balance).to.be.equal(parseEther("23"));
  });

  it("Should lock multiple whitelisted token", async () => {
    const {
      budgetContract,
      budgetToken,
      budgetToken1,
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
    await expect(budgetContract.lockFunds(
      budgetName,
      [tokenAddress, tokenAddress1],
      [amount, amount + parseEther("1")],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    )).to.emit(budgetContract,"BudgetCreated");

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

    let _balance = await budgetToken.balanceOf(userAddress);
    expect(_balance).to.be.equal(parseEther("89"));
    _balance = await budgetToken1.balanceOf(userAddress);
    expect(_balance).to.be.equal(parseEther("88"));
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
    await expect(budgetContract.lockFunds(
      budgetName,
      [tokenAddress],
      [amount],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    )).to.emit(budgetContract,"BudgetCreated");
    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle);

    const details = await budgetContract.getBudgetDetails(budgetName);

    expect(details.tokens[0]).equal(tokenAddress);
    expect(details.balances[0]).equal(amount);
    expect(details.releaseCycle).equal(cycle);
    expect(details.releaseAmount).equal(releaseAmount);
    // expect(details.lastReleaseTime).equal(await blockTimestamp());
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
    await expect(budgetContract.lockFunds(
      budgetName,
      [tokenAddress,tokenAddress1],
      [amount,amount+parseEther("1")],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    )).to.emit(budgetContract,"BudgetCreated");
    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle);

    const details = await budgetContract.getBudgetDetails(budgetName);

    expect(details.tokens[0]).equal(tokenAddress);
    expect(details.balances[0]).equal(amount);
    expect(details.tokens[1]).equal(tokenAddress1);
    expect(details.balances[1]).equal(amount+parseEther("1"));
    expect(details.releaseCycle).equal(cycle);
    expect(details.releaseAmount).equal(releaseAmount);
    // expect(details.lastReleaseTime).equal(await blockTimestamp());
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
    await expect(budgetContract.lockFunds(
      budgetName,
      [tokenAddress],
      [amount],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    )).to.emit(budgetContract,"BudgetCreated");
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
    await expect(budgetContract.lockFunds(
      budgetName,
      [tokenAddress,tokenAddress1],
      [amount,amount+parseEther("1")],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    )).to.emit(budgetContract,"BudgetCreated");
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
    await expect(budgetContract.lockFunds(
      budgetName,
      [tokenAddress2],
      [amount],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    )).to.emit(budgetContract,"BudgetCreated");
    timestamp = await blockTimestamp()
    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle);
     availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount+releaseAmount).to.equal(availableBalance);
    await budgetContract.whitelistToken(tokenAddress2,false)
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount+releaseAmount).to.equal(availableBalance);

    await expect(budgetContract.releaseFunds(budgetName,userAddress)).to.emit(budgetContract,"BudgetWithdraw")
    expect(await budgetToken2.balanceOf(budgetContractAddress)).to.be.equal(parseEther("13"))
    expect( await budgetToken2.balanceOf(userAddress)).to.be.equal(parseEther("87"))
    timestamp = await blockTimestamp()
    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle+cycle);
    await expect(budgetContract.releaseFunds(budgetName,userAddress)).to.emit(budgetContract,"BudgetWithdraw")
    expect(await budgetToken2.balanceOf(budgetContractAddress)).to.be.equal(parseEther("0"))
    expect(await budgetToken2.balanceOf(userAddress)).to.be.equal(parseEther("100"))

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
    await expect(budgetContract.lockFunds(
      budgetName,
      [tokenAddress],
      [amount],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    )).to.emit(budgetContract,"BudgetCreated");
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
    expect(parseEther("10")).to.equal(availableBalance);

    await budgetContract.releaseFunds(budgetName,userAddress)
    expect(await budgetToken.balanceOf(budgetContractAddress)).to.be.equal(parseEther("13"))
    expect(await budgetToken.balanceOf(userAddress)).to.be.equal(parseEther("87"))

    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle+cycle+cycle+cycle);
    await expect(budgetContract.releaseFunds(budgetName,userAddress)).to.emit(budgetContract,"BudgetWithdraw")
     expect(await budgetToken.balanceOf(budgetContractAddress)).to.be.equal(parseEther("0"))
     expect(await budgetToken.balanceOf(userAddress)).to.be.equal(parseEther("100"))
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
    await expect(budgetContract.lockFunds(
      budgetName,
      [tokenAddress],
      [amount],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    )).to.emit(budgetContract,"BudgetCreated");
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
    expect(parseEther("10")).to.equal(availableBalance);

    await expect(budgetContract.releaseFunds(budgetName,userAddress)).to.emit(budgetContract,"BudgetWithdraw")
    expect(await budgetToken.balanceOf(budgetContractAddress)).to.be.equal(parseEther("13"))
    expect(await budgetToken.balanceOf(userAddress)).to.be.equal(parseEther("87"))
    timestamp = await blockTimestamp()
    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle+cycle);
    await expect(budgetContract.releaseFunds(budgetName,userAddress)).to.emit(budgetContract,"BudgetWithdraw")
    expect(await budgetToken.balanceOf(budgetContractAddress)).to.be.equal(parseEther("0"))
    expect(await budgetToken.balanceOf(userAddress)).to.be.equal(parseEther("100"))
  });



  it("Should update release amount of whitelisted token", async () => {

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
    await time.increaseTo(BigInt((timestamp) + BigInt(startDelta)));
    let availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("0")).to.equal(availableBalance);

    timestamp = await blockTimestamp();
    await expect(budgetContract.lockFunds(
      budgetName,
      [tokenAddress],
      [amount],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    )).to.emit(budgetContract,"BudgetCreated");
    
    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle);
     availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount+releaseAmount).to.equal(availableBalance);

    await expect(budgetContract.updateReleaseAmount(budgetName,releaseAmount+parseEther("10")))
    .to.revertedWith("Cannot update release amount while balance is non-zero")
    timestamp = await blockTimestamp();
    await time.increaseTo(BigInt(timestamp) + cycle+cycle+cycle);
    await budgetContract.releaseFunds(budgetName,userAddress);
    expect(await budgetToken.balanceOf(budgetContractAddress)).to.be.equal(parseEther("0"))
    expect(await budgetToken.balanceOf(userAddress)).to.be.equal(parseEther("100"))

    await budgetContract.updateReleaseAmount(budgetName,releaseAmount+parseEther("10"))
    timestamp = await blockTimestamp();
    await expect(budgetContract.topUpBudget(
      budgetName,
      [tokenAddress],
      [amount],
    )).to.emit(budgetContract,"BudgetTopUp");
    timestamp = await blockTimestamp();
    await time.increaseTo(BigInt(timestamp) + cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount+parseEther("10")).to.equal(availableBalance);
    timestamp = await blockTimestamp();
    await time.increaseTo(timestamp + cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("23")).to.equal(availableBalance);

  });
  it("Should update release amount of multiple whitelisted token", async () => {
    const {
      budgetContract,
      tokenAddress,
      tokenAddress1,
      blockTimestamp,
      budgetName,
      userAddress,
      budgetToken,
      budgetContractAddress
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
      [tokenAddress,tokenAddress1],
      [amount,amount+parseEther("1")],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    );
    expect(await budgetContract.totalBalance(budgetName)).to.be.equal(parseEther("23"))

    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle);
     availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount+releaseAmount).to.equal(availableBalance);

    await expect(budgetContract.updateReleaseAmount(budgetName,releaseAmount+parseEther("10")))
    .to.revertedWith("Cannot update release amount while balance is non-zero")
    timestamp = await blockTimestamp();
    await time.increaseTo(BigInt(timestamp) + cycle+cycle+cycle);
    await expect(budgetContract.releaseFunds(budgetName,userAddress)).to.emit(budgetContract,"BudgetWithdraw");
    expect(await budgetContract.totalBalance(budgetName)).to.be.equal(parseEther("0"))

    expect(await budgetContract.totalBalance(budgetName)).to.be.equal(parseEther("0"))
    expect(await budgetToken.balanceOf(budgetContractAddress)).to.be.equal(parseEther("0"))
    expect(await budgetToken.balanceOf(userAddress)).to.be.equal(parseEther("100"))

    await budgetContract.updateReleaseAmount(budgetName,releaseAmount+parseEther("10"))
    timestamp = await blockTimestamp();
    await budgetContract.topUpBudget(
      budgetName,
      [tokenAddress,tokenAddress1],
      [amount,amount+parseEther("1")],
    );
    expect(await budgetContract.totalBalance(budgetName)).to.be.equal(parseEther("23"))

    timestamp = await blockTimestamp();
    await time.increaseTo(BigInt(timestamp) + cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount+parseEther("10")).to.equal(availableBalance);
    timestamp = await blockTimestamp();
    await time.increaseTo(timestamp + cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("23")).to.equal(availableBalance);

  });
  it("Should top up single whitelisted token", async () => {
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
    await expect(budgetContract.lockFunds(
      budgetName,
      [tokenAddress],
      [amount],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    )).to.emit(budgetContract,"BudgetCreated");

    expect(await budgetContract.totalBalance(budgetName)).to.be.equal(amount)

    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle);
     availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount+releaseAmount).to.equal(availableBalance);

    await expect(budgetContract.updateReleaseAmount(budgetName,releaseAmount+parseEther("10")))
    .to.revertedWith("Cannot update release amount while balance is non-zero")
    // timestamp = await blockTimestamp();
    // await time.increaseTo(BigInt(timestamp) + cycle+cycle+cycle);
    await budgetContract.releaseFunds(budgetName,userAddress);
    expect(await budgetContract.totalBalance(budgetName)).to.be.equal(parseEther("13"))

  
    expect(await budgetToken.balanceOf(budgetContractAddress)).to.be.equal(parseEther("13"))
    expect(await budgetToken.balanceOf(userAddress)).to.be.equal(parseEther("87"))

    
    timestamp = await blockTimestamp();
    await budgetContract.topUpBudget(
      budgetName,
      [tokenAddress],
      [parseEther("10")],
    );
    expect(await budgetContract.totalBalance(budgetName)).to.be.equal(parseEther("23"))

    timestamp = await blockTimestamp();
    await time.increaseTo(BigInt(timestamp) + cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount).to.equal(availableBalance);
    timestamp = await blockTimestamp();
    await time.increaseTo(timestamp + cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount+releaseAmount).to.equal(availableBalance);
  });
  it("Should top up multiple whitelisted token", async () => {
    const {
      budgetContract,
      tokenAddress,
      tokenAddress1,
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
    expect(await budgetContract.totalBalance(budgetName)).to.be.equal(amount)

    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle);
     availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount+releaseAmount).to.equal(availableBalance);

    await expect(budgetContract.updateReleaseAmount(budgetName,releaseAmount+parseEther("10")))
    .to.revertedWith("Cannot update release amount while balance is non-zero")
    // timestamp = await blockTimestamp();
    // await time.increaseTo(BigInt(timestamp) + cycle+cycle+cycle);
    await expect(budgetContract.releaseFunds(budgetName,userAddress)).to.emit(budgetContract,"BudgetWithdraw");
    expect(await budgetContract.totalBalance(budgetName)).to.be.equal(parseEther("13"))

  
    expect(await budgetToken.balanceOf(budgetContractAddress)).to.be.equal(parseEther("13"))
    expect(await budgetToken.balanceOf(userAddress)).to.be.equal(parseEther("87"))

    
    timestamp = await blockTimestamp();
    await expect(budgetContract.topUpBudget(
      budgetName,
      [tokenAddress,tokenAddress1],
      [releaseAmount,releaseAmount],
    )).to.emit(budgetContract,"BudgetTopUp");

    expect(await budgetContract.totalBalance(budgetName)).to.be.equal(parseEther("23"))

    timestamp = await blockTimestamp();
    await time.increaseTo(BigInt(timestamp) + cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount).to.equal(availableBalance);
    timestamp = await blockTimestamp();
    await time.increaseTo(timestamp + cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount+releaseAmount).to.equal(availableBalance);
  });
  

  it("Should update release cycle of whitelisted token", async () => {
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
    await expect(budgetContract.lockFunds(
      budgetName,
      [tokenAddress],
      [amount],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    )).to.emit(budgetContract,"BudgetCreated");
    
    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle);
     availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount+releaseAmount).to.equal(availableBalance);

    await expect(budgetContract.updateReleaseCycle(budgetName,cycle+cycle))
    .to.revertedWith("Cannot update release cycle while balance is non-zero")
    timestamp = await blockTimestamp();
    await time.increaseTo(BigInt(timestamp) + cycle+cycle+cycle);
    await budgetContract.releaseFunds(budgetName,userAddress);
    expect(await budgetToken.balanceOf(budgetContractAddress)).to.be.equal(parseEther("0"))
    expect(await budgetToken.balanceOf(userAddress)).to.be.equal(parseEther("100"))

    await budgetContract.updateReleaseCycle(budgetName,cycle+cycle)
    timestamp = await blockTimestamp();
    await expect(budgetContract.topUpBudget(
      budgetName,
      [tokenAddress],
      [amount],
    )).to.emit(budgetContract,"BudgetTopUp");

    timestamp = await blockTimestamp();
    await time.increaseTo(BigInt(timestamp) + cycle+cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount).to.equal(availableBalance);
    timestamp = await blockTimestamp();
    await time.increaseTo(timestamp + cycle+cycle+cycle+cycle+cycle+cycle+cycle+cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("23")).to.equal(availableBalance);
  });
  it("Should update release cycle of multiple whiteliste token", async () => {
    const {
      budgetContract,
      tokenAddress,
      tokenAddress1,
      blockTimestamp,
      budgetName,
      userAddress,
      budgetToken,
      budgetContractAddress
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
    await expect(budgetContract.lockFunds(
      budgetName,
      [tokenAddress,tokenAddress1],
      [amount,amount+parseEther("1")],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    )).to.emit(budgetContract,"BudgetCreated");
    
    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle);
     availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount+releaseAmount).to.equal(availableBalance);

    await expect(budgetContract.updateReleaseCycle(budgetName,cycle+cycle))
    .to.revertedWith("Cannot update release cycle while balance is non-zero")

    timestamp = await blockTimestamp();
    await time.increaseTo(BigInt(timestamp) + cycle+cycle+cycle);

    await expect(budgetContract.releaseFunds(budgetName,userAddress)).to.emit(budgetContract,"BudgetWithdraw");

    expect(await budgetToken.balanceOf(budgetContractAddress)).to.be.equal(parseEther("0"))
    expect(await budgetToken.balanceOf(userAddress)).to.be.equal(parseEther("100"))

    await budgetContract.updateReleaseCycle(budgetName,cycle+cycle)
    timestamp = await blockTimestamp();
    await expect(budgetContract.topUpBudget(
      budgetName,
      [tokenAddress,tokenAddress1],
      [amount,amount+parseEther("1")]
    )).to.emit(budgetContract,"BudgetTopUp");

    timestamp = await blockTimestamp();
    await time.increaseTo(BigInt(timestamp) + cycle+cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount).to.equal(availableBalance);
    timestamp = await blockTimestamp();
    await time.increaseTo(timestamp + cycle+cycle+cycle+cycle+cycle+cycle+cycle+cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(parseEther("23")).to.equal(availableBalance);
  });
  it("Should get total balance corretly", async () => {
    const {
      budgetContract,
      tokenAddress,
      tokenAddress1,
      blockTimestamp,
      budgetName,
      userAddress,
      budgetToken,
      budgetContractAddress
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
    await expect(budgetContract.lockFunds(
      budgetName,
      [tokenAddress,tokenAddress1],
      [amount,amount+parseEther("1")],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    )).to.emit(budgetContract,"BudgetCreated");
    
    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle);
     availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount+releaseAmount).to.equal(availableBalance);
    expect(await budgetContract.totalBalance(budgetName)).to.be.equal(parseEther("23"))
    await expect(budgetContract.releaseFunds(budgetName,userAddress)).to.emit(budgetContract,"BudgetWithdraw");
    timestamp = await blockTimestamp();
    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount).to.equal(availableBalance);
    await budgetContract.releaseFunds(budgetName,userAddress);
    availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(BigInt(0)).to.equal(availableBalance);
    expect(await budgetContract.totalBalance(budgetName)).to.be.equal(parseEther("8"))



  });
  it("Should get allowed tokens", async () => {
    const {
      budgetContract,
      tokenAddress,
      tokenAddress1,
      tokenAddress2,
      blockTimestamp,
      budgetName,
      userAddress,
      budgetToken,
      budgetContractAddress
    } = await loadFixture(deployContracts);
    expect(await budgetContract.allowedTokens(tokenAddress)).to.be.equal(true)
    expect(await budgetContract.allowedTokens(tokenAddress1)).to.be.equal(true)
    expect(await budgetContract.allowedTokens(tokenAddress2)).to.be.equal(false)
    expect(await budgetContract.allowedTokens(userAddress)).to.be.equal(false)

  });
  
it("Should fail to interact with disabled budget",async()=>{
  const {
    budgetContract,
    tokenAddress,
    tokenAddress1,
    userAddress,
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
  await expect(budgetContract.lockFunds(
    budgetName,
    [tokenAddress,tokenAddress1],
    [amount,amount+parseEther("1")],
    cycle,
    timestamp + BigInt(startDelta),
    releaseAmount
  )).to.emit(budgetContract,"BudgetCreated");

  await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle+cycle+cycle+cycle);
     availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );

await expect(budgetContract.changeBudgetStatus(budgetName,false)).to.emit(budgetContract,"BudgetStatusChanged")

await expect(budgetContract.releaseFunds(budgetName,userAddress)).revertedWith("Budget is disabled");
timestamp = await blockTimestamp();
await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle+cycle+cycle+cycle);

await expect(budgetContract.changeBudgetStatus(budgetName,true)).to.emit(budgetContract,"BudgetStatusChanged")
await expect(budgetContract.releaseFunds(budgetName,userAddress)).to.emit(budgetContract,"BudgetWithdraw");
await expect(budgetContract.changeBudgetStatus(budgetName,false)).to.emit(budgetContract,"BudgetStatusChanged")
await expect(budgetContract.updateReleaseAmount(budgetName,100)).revertedWith("Budget is disabled");
await expect(budgetContract.updateReleaseCycle(budgetName,100)).revertedWith("Budget is disabled");



})

  it("Should return all budgets by name", async()=>{
    const {
      budgetContract,
      tokenAddress,
      tokenAddress1,
      tokenAddress2,
      blockTimestamp,
      budgetName,
      userAddress,
      budgetToken,
      budgetContractAddress
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
    await expect(budgetContract.lockFunds(
      budgetName,
      [tokenAddress,tokenAddress1],
      [amount,amount+parseEther("1")],
      cycle,
      timestamp + BigInt(startDelta),
      releaseAmount
    )).to.emit(budgetContract,"BudgetCreated");
    
    await time.increaseTo(BigInt(timestamp) + BigInt(startDelta) + cycle+cycle);
     availableBalance = await budgetContract.getAvailableBalanceToRelease(
      budgetName
    );
    expect(releaseAmount+releaseAmount).to.equal(availableBalance);
    const budgets = await budgetContract.getBudgets();
    expect(budgets.length).to.be.equal(1)
    expect(budgets.at(0)).to.be.equal(budgetName)
  })

 

it("Should handle accurate timing for release cycles", async () => {
  const {
    budgetContract,
    tokenAddress,
    blockTimestamp,
    budgetName,
    userAddress,
    budgetToken,
    budgetContractAddress
  } = await loadFixture(deployContracts);
  
  // Set up parameters
  const amount = parseEther("1"); // Lock 1 ETH
  const topupAmount = parseEther("10"); // Will top up with 10 ETH later
  const releaseAmount = parseEther("1"); // Release 1 ETH per cycle
  const cycle = BigInt(2); // 2 second cycles
  
  // Current timestamp
  let timestamp = await blockTimestamp();
  
  // Lock funds
  await expect(budgetContract.lockFunds(
    budgetName,
    [tokenAddress],
    [amount],
    cycle,
    timestamp, // Start immediately
    releaseAmount
  )).to.emit(budgetContract, "BudgetCreated");
  
  // Wait 4 seconds (2 cycles)
  await time.increaseTo(timestamp + BigInt(4));
  
  // Check available balance is 2 ETH (1 ETH per cycle * 2 cycles)
  let availableBalance = await budgetContract.getAvailableBalanceToRelease(budgetName);
  expect(availableBalance).to.equal(parseEther("1")); // Should be limited to the 1 ETH we deposited
  
  // Withdraw funds
  await expect(budgetContract.releaseFunds(budgetName, userAddress))
    .to.emit(budgetContract, "BudgetWithdraw");
  
  // Verify contract and user balances
  expect(await budgetToken.balanceOf(budgetContractAddress)).to.equal(parseEther("0"));
  expect(await budgetToken.balanceOf(userAddress)).to.equal(parseEther("100")); // Back to original 100 ETH
  
  // Wait 6 more seconds
  timestamp = await blockTimestamp();
  await time.increaseTo(timestamp + BigInt(6));
  
  // Top up with 10 ETH
  await expect(budgetContract.topUpBudget(
    budgetName,
    [tokenAddress],
    [topupAmount]
  )).to.emit(budgetContract, "BudgetTopUp");
  
  // Wait 4 more seconds (2 cycles)
  timestamp = await blockTimestamp();
  await time.increaseTo(timestamp + BigInt(4));
  
  // Check available balance is 2 ETH (1 ETH per cycle * 2 cycles)
  availableBalance = await budgetContract.getAvailableBalanceToRelease(budgetName);
  expect(availableBalance).to.equal(parseEther("2"));
  
  // Verify total balance in the budget
  const totalBalance = await budgetContract.totalBalance(budgetName);
  expect(totalBalance).to.equal(parseEther("10"));
});
});
