// One choice out of a few (language on HM-ONB-02 and HM-SET-05, the scheme on HM-SET-07, a connector's sign-in on
// HM-CONN-04). TalkBack reads each row as a radio with its label, its detail and whether it is selected; rows grow with
// the text, never a fixed height. Design pass: the kit's radio rows in one grouped list.
import { View } from "react-native";
import { Group, Radio } from "./kit";

export interface Choice<T extends string> {
  value: T;
  label: string;
  detail?: string;
}

export function ChoiceList<T extends string>({ choices, selected, disabled, onChoose }: { choices: ReadonlyArray<Choice<T>>; selected: T; disabled?: boolean; onChoose(value: T): void }) {
  return (
    <View accessibilityRole="radiogroup">
      <Group>
        {choices.map((c) => (
          <Radio key={c.value} label={c.label} {...(c.detail ? { sub: c.detail } : {})} on={c.value === selected} disabled={disabled} onPress={() => onChoose(c.value)} />
        ))}
      </Group>
    </View>
  );
}
