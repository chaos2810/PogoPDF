import { useState } from "react";
import { TOOL_IDS } from "@pogopdf/contracts";
import { FileToolScreen } from "../FileToolScreen";
import { Field, RadioGroup } from "./forms";

type Order = "alternate" | "inverse";

export function AlternateMixScreen() {
  const [order, setOrder] = useState<Order>("alternate");
  return (
    <FileToolScreen
      toolId={TOOL_IDS.alternateMix}
      acceptMultiple
      ctaKey="tool.alternateMix.cta"
      canRun={(files) => files.length === 2}
      validationError={(files) =>
        files.length > 0 && files.length !== 2 ? "tool.common.needTwo" : null
      }
      buildInput={(files) => ({ filePaths: files, order })}
      options={
        <Field labelKey="tool.alternateMix.order">
          <RadioGroup
            name="mix-order"
            value={order}
            onChange={(v) => setOrder(v as Order)}
            choices={[
              { value: "alternate", labelKey: "tool.alternateMix.orderAlternate" },
              { value: "inverse", labelKey: "tool.alternateMix.orderInverse" },
            ]}
          />
        </Field>
      }
    />
  );
}
