import { ScrollDropdown as Dropdown } from '../kit/ScrollDropdown.tsx';
import { Button, Field, Input, Option, Popover, PopoverTrigger } from '@fluentui/react-components';
import { Add16Regular } from '@fluentui/react-icons';
import { useAtomValueRawSync } from 'jotai/react';
import { useState, type ReactElement } from 'react';
import { translateAtom } from '../i18n/locale.ts';
import { useViewControlStyles } from '../theme/controlStyles.ts';
import { PopoverSurface } from '../theme/PopoverSurface.tsx';
import {
  CONDITION_FIELDS,
  CONDITION_OPERATORS,
  OPERATOR_LABELS,
  conditionQuery,
  type ConditionField,
  type TrackCondition,
} from './trackConditions.ts';
import styles from './ConditionEditor.module.css';

const FIELDS = Object.keys(CONDITION_FIELDS).filter(
  (key): key is ConditionField => key in CONDITION_FIELDS,
);
const INITIAL: TrackCondition = { field: 'rating', operator: 'atLeast', value: '', end: '' };

export function ConditionEditor({
  playcount,
  onAdd,
  trigger,
}: {
  readonly playcount: boolean | null;
  readonly onAdd: (condition: TrackCondition) => void;
  /** 换掉缺省的「添加条件」键，参数是编辑浮层开没开；没有分面的页面拿筛选键当入口 */
  readonly trigger?: (open: boolean) => ReactElement;
}) {
  const t = useAtomValueRawSync(translateAtom);
  const controls = useViewControlStyles();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<TrackCondition>(INITIAL);
  const field = CONDITION_FIELDS[draft.field];
  const needsStats = 'playcount' in field && field.playcount;
  const operators = CONDITION_OPERATORS[field.kind];
  const valid = !(needsStats && playcount === false) && conditionQuery(draft) !== null;
  return (
    <Popover
      open={open}
      onOpenChange={(_, data) => setOpen(data.open)}
      positioning="below-end"
      trapFocus
    >
      <PopoverTrigger disableButtonEnhancement>
        {trigger ? (
          trigger(open)
        ) : (
          <Button
            size="small"
            appearance="subtle"
            className={controls.icon}
            icon={<Add16Regular />}
            data-condition-add
          >
            {t('query.addCondition')}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverSurface>
        <div className={styles.root}>
          <Field label={t('query.conditionField')}>
            <Dropdown
              value={t(field.label)}
              selectedOptions={[draft.field]}
              onOptionSelect={(_, data) => {
                const selected = FIELDS.find((key) => key === data.optionValue);
                if (selected)
                  setDraft({
                    field: selected,
                    operator: CONDITION_OPERATORS[CONDITION_FIELDS[selected].kind][0] ?? 'is',
                    value: '',
                    end: '',
                  });
              }}
            >
              {FIELDS.map((key) => {
                const definition = CONDITION_FIELDS[key];
                const unavailable = 'playcount' in definition && playcount === false;
                return (
                  <Option key={key} value={key} disabled={unavailable}>
                    {t(definition.label)}
                  </Option>
                );
              })}
            </Dropdown>
          </Field>
          <Field label={t('query.conditionOperator')}>
            <Dropdown
              value={t(OPERATOR_LABELS[draft.operator])}
              selectedOptions={[draft.operator]}
              onOptionSelect={(_, data) => {
                const operator = operators.find((value) => value === data.optionValue);
                if (operator) setDraft({ ...draft, operator });
              }}
            >
              {operators.map((operator) => (
                <Option key={operator} value={operator}>
                  {t(OPERATOR_LABELS[operator])}
                </Option>
              ))}
            </Dropdown>
          </Field>
          {draft.operator !== 'missing' && (
            <Field
              label={t(field.kind === 'recent' ? 'query.days' : 'query.conditionValue')}
              validationMessage={
                draft.value && !valid
                  ? t(
                      field.kind === 'text'
                        ? 'query.unsupportedConditionText'
                        : 'query.invalidCondition',
                    )
                  : undefined
              }
              validationState={draft.value && !valid ? 'error' : 'none'}
            >
              <Input
                value={draft.value}
                type={field.kind === 'text' ? 'text' : 'number'}
                min={field.kind === 'recent' ? 1 : 0}
                step={1}
                onChange={(_, data) => setDraft({ ...draft, value: data.value })}
              />
            </Field>
          )}
          {draft.operator === 'between' && (
            <Field label={t('query.conditionEnd')}>
              <Input
                type="number"
                min={0}
                step={1}
                value={draft.end}
                onChange={(_, data) => setDraft({ ...draft, end: data.value })}
              />
            </Field>
          )}
          <Button
            appearance="primary"
            disabled={!valid}
            onClick={() => {
              onAdd({ ...draft, value: draft.value.trim(), end: draft.end.trim() });
              setOpen(false);
            }}
          >
            {t('query.addCondition')}
          </Button>
        </div>
      </PopoverSurface>
    </Popover>
  );
}
