import { ActionButton, Alert, Modal, Panel } from "@namada/components";
import { BondMsgValue, BondProps } from "@namada/types";
import { AtomErrorBoundary } from "App/Common/AtomErrorBoundary";
import { Info } from "App/Common/Info";
import { ModalContainer } from "App/Common/ModalContainer";
import { NamCurrency } from "App/Common/NamCurrency";
import { TableRowLoading } from "App/Common/TableRowLoading";
import { TransactionFees } from "App/Common/TransactionFees";
import { accountBalanceAtom, defaultAccountAtom } from "atoms/accounts";
import { gasLimitsAtom, minimumGasPriceAtom } from "atoms/fees";
import {
  createNotificationId,
  dispatchToastNotificationAtom,
} from "atoms/notifications";
import { createBondTxAtom } from "atoms/staking";
import { allValidatorsAtom } from "atoms/validators";
import clsx from "clsx";
import { useStakeModule } from "hooks/useStakeModule";
import { useValidatorFilter } from "hooks/useValidatorFilter";
import { useValidatorSorting } from "hooks/useValidatorSorting";
import invariant from "invariant";
import { useAtomValue, useSetAtom } from "jotai";
import { TransactionPair, broadcastTx } from "lib/query";
import { useEffect, useState } from "react";
import { GoAlert } from "react-icons/go";
import { useNavigate } from "react-router-dom";
import { BondingAmountOverview } from "./BondingAmountOverview";
import { IncrementBondingTable } from "./IncrementBondingTable";
import { ValidatorFilterNav } from "./ValidatorFilterNav";
import StakingRoutes from "./routes";

const IncrementBonding = (): JSX.Element => {
  const [filter, setFilter] = useState<string>("");
  const [onlyMyValidators, setOnlyMyValidators] = useState(false);
  const navigate = useNavigate();
  const accountBalance = useAtomValue(accountBalanceAtom);
  const gasPrice = useAtomValue(minimumGasPriceAtom);
  const gasLimits = useAtomValue(gasLimitsAtom);
  const { data: account } = useAtomValue(defaultAccountAtom);
  const validators = useAtomValue(allValidatorsAtom);
  const dispatchNotification = useSetAtom(dispatchToastNotificationAtom);
  const resultsPerPage = 100;
  const [seed, setSeed] = useState(Math.random());

  const {
    mutate: createBondTransaction,
    isPending: isPerformingBond,
    isSuccess,
    isError,
    data: bondTransactionData,
    error: bondTransactionError,
  } = useAtomValue(createBondTxAtom);

  const {
    myValidators,
    totalUpdatedAmount,
    totalStakedAmount,
    totalNamAfterStaking,
    stakedAmountByAddress,
    updatedAmountByAddress,
    onChangeValidatorAmount,
    parseUpdatedAmounts,
  } = useStakeModule({ account });

  const filteredValidators = useValidatorFilter({
    validators: validators.isSuccess ? validators.data : [],
    myValidatorsAddresses: Array.from(
      new Set([
        ...Object.keys(stakedAmountByAddress),
        ...Object.keys(updatedAmountByAddress),
      ])
    ),
    searchTerm: filter,
    onlyMyValidators,
  });

  const sortedValidators = useValidatorSorting({
    validators: filteredValidators,
    updatedAmountByAddress,
    seed,
  });

  const onCloseModal = (): void => navigate(StakingRoutes.overview().url);

  const onSubmit = (e: React.FormEvent): void => {
    e.preventDefault();
    invariant(
      account,
      "Extension is not connected or you don't have an account"
    );
    const changes = parseUpdatedAmounts();
    invariant(gasPrice.data, "Gas price loading is still pending");
    invariant(gasLimits.isSuccess, "Gas limit loading is still pending");
    const bondGasLimit = gasLimits.data!.Bond.native;
    createBondTransaction({
      changes,
      account,
      gasConfig: {
        gasPrice: gasPrice.data!,
        gasLimit: bondGasLimit.multipliedBy(changes.length),
      },
    });
  };

  const dispatchPendingNotification = (
    data?: TransactionPair<BondMsgValue>
  ): void => {
    dispatchNotification({
      id: createNotificationId(data?.encodedTxData.txs),
      title: "Staking transaction in progress",
      description: (
        <>
          Your staking transaction of{" "}
          <NamCurrency amount={totalUpdatedAmount} /> is being processed
        </>
      ),
      type: "pending",
    });
  };

  const dispatchBondingTransaction = (tx: TransactionPair<BondProps>): void => {
    tx.signedTxs.forEach((signedTx) => {
      broadcastTx(
        tx.encodedTxData,
        signedTx,
        tx.encodedTxData.meta?.props,
        "Bond"
      );
    });
  };

  useEffect(() => {
    if (isSuccess) {
      bondTransactionData && dispatchBondingTransaction(bondTransactionData);
      dispatchPendingNotification(bondTransactionData);
      onCloseModal();
    }
  }, [isSuccess]);

  useEffect(() => {
    if (isError) {
      dispatchNotification({
        id: createNotificationId(),
        title: "Staking transaction failed",
        description: "",
        details:
          bondTransactionError instanceof Error ?
            bondTransactionError.message
          : undefined,
        timeout: 5000,
        type: "error",
      });
    }
  }, [isError]);

  const errorMessage = ((): string => {
    if (accountBalance.isPending) return "Loading...";
    if (accountBalance.data?.lt(totalUpdatedAmount))
      return "Error: not enough balance";
    return "";
  })();

  return (
    <Modal onClose={onCloseModal}>
      <ModalContainer
        header={
          <span className="flex items-center gap-3">
            Select Validators to delegate your NAM{" "}
            <Info>
              Enter staking values across multiple validators. The total amount
              should be less than the total NAM available in your account.
              Please leave a small amount for transaction fees.
            </Info>
          </span>
        }
        onClose={onCloseModal}
      >
        <form
          onSubmit={onSubmit}
          className="grid grid-rows-[max-content_auto_max-content] gap-2 h-full"
        >
          <div className="grid grid-cols-[repeat(auto-fit,_minmax(8rem,_1fr))] gap-1.5">
            <BondingAmountOverview
              title="Available to Stake"
              className="col-span-2"
              stackClassName="grid grid-rows-[auto_auto_auto]"
              amountInNam={accountBalance.data ?? 0}
              updatedAmountInNam={totalNamAfterStaking}
              extraContent={
                <>
                  <Alert
                    type="warning"
                    className={clsx(
                      "rounded-sm text-xs",
                      "py-3 right-2 top-4 max-w-[240px]",
                      "sm:col-start-2 sm:row-span-full sm:justify-self-end"
                    )}
                  >
                    <div className="flex items-center gap-3 text-xs">
                      <i className="text-base">
                        <GoAlert />
                      </i>
                      <p className="text-balance">
                        Staking will lock and bind your assets to the TODO
                        unbonding schedule. To make your NAM liquid again, you
                        will need to unstake.
                      </p>
                    </div>
                  </Alert>
                </>
              }
            />
            <BondingAmountOverview
              title="Current Stake"
              amountInNam={totalStakedAmount}
            />
            <BondingAmountOverview
              title="Increased Stake"
              updatedAmountInNam={totalUpdatedAmount}
              updatedValueClassList="text-yellow"
              amountInNam={0}
            />
          </div>
          <Panel className="grid grid-rows-[max-content_auto] w-full relative overflow-hidden">
            {validators.isSuccess && (
              <ValidatorFilterNav
                validators={validators.data}
                updatedAmountByAddress={updatedAmountByAddress}
                stakedAmountByAddress={stakedAmountByAddress}
                onChangeSearch={(value: string) => setFilter(value)}
                onlyMyValidators={onlyMyValidators}
                onFilterByMyValidators={setOnlyMyValidators}
                onRandomize={() => setSeed(Math.random())}
              />
            )}
            {(validators.isLoading || myValidators.isLoading) && (
              <div className="mt-3">
                <TableRowLoading count={2} />
              </div>
            )}
            <AtomErrorBoundary
              result={[validators, myValidators]}
              niceError="Unable to load validators list"
              containerProps={{ className: "span-2" }}
            >
              {validators.isSuccess && myValidators.isSuccess && (
                <IncrementBondingTable
                  resultsPerPage={resultsPerPage}
                  validators={sortedValidators}
                  onChangeValidatorAmount={onChangeValidatorAmount}
                  updatedAmountByAddress={updatedAmountByAddress}
                  stakedAmountByAddress={stakedAmountByAddress}
                />
              )}
            </AtomErrorBoundary>
          </Panel>
          <div className="relative grid grid-cols-[1fr_25%_1fr] items-center">
            <ActionButton
              type="submit"
              size="sm"
              className="mt-2 col-start-2"
              backgroundColor="cyan"
              disabled={
                !!errorMessage || isPerformingBond || totalUpdatedAmount.eq(0)
              }
            >
              {isPerformingBond ? "Processing..." : errorMessage || "Stake"}
            </ActionButton>
            <TransactionFees
              className="justify-self-end px-4"
              numberOfTransactions={Object.keys(updatedAmountByAddress).length}
            />
          </div>
        </form>
      </ModalContainer>
    </Modal>
  );
};

export default IncrementBonding;
