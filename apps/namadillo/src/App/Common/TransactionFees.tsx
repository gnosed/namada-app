import clsx from "clsx";
import { useGasEstimate } from "hooks/useGasEstimate";
import { NamCurrency } from "./NamCurrency";
import { TextLink } from "./TextLink";
type TransactionFeesProps = {
  numberOfTransactions: number;
  className?: string;
};

export const TransactionFees = ({
  numberOfTransactions,
  className,
}: TransactionFeesProps): JSX.Element => {
  const { calculateMinGasRequired } = useGasEstimate();
  const minimumGas = calculateMinGasRequired(numberOfTransactions);

  if (!minimumGas || minimumGas.eq(0)) return <></>;
  return (
    <div className={clsx("text-white text-sm", className)}>
      <TextLink>Transaction fee:</TextLink>{" "}
      <NamCurrency className="font-medium" amount={minimumGas} />
    </div>
  );
};
