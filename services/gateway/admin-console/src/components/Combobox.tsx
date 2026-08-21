import * as Select from '@radix-ui/react-select';

export function Combobox({
  value,
  onValueChange,
  options,
  placeholder,
}: {
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
}) {
  return (
    <Select.Root value={value} onValueChange={onValueChange}>
      <Select.Trigger className="w-full flex items-center justify-between rounded border border-line bg-paper-raised px-3 py-2 text-sm text-ink focus:outline-none focus:border-brass">
        <Select.Value placeholder={placeholder} />
        <Select.Icon>▾</Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content className="bg-paper border border-line rounded shadow-lg overflow-hidden z-50">
          <Select.Viewport>
            {options.map((opt) => (
              <Select.Item
                key={opt.value}
                value={opt.value}
                className="px-3 py-2 text-sm text-ink cursor-pointer hover:bg-paper-raised outline-none data-[state=checked]:bg-brass/10"
              >
                <Select.ItemText>{opt.label}</Select.ItemText>
              </Select.Item>
            ))}
          </Select.Viewport>
        </Select.Content>
      </Select.Portal>
    </Select.Root>
  );
}
