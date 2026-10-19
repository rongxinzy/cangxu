import {
  Alert,
  Badge,
  Button,
  FileInput,
  Group,
  Modal,
  ScrollArea,
  Select,
  Stack,
  Table,
  Text
} from '@mantine/core';
import {
  IconAlertCircle,
  IconCircleCheck,
  IconDownload,
  IconFileSpreadsheet,
  IconUpload
} from '@tabler/icons-react';
import { isAxiosError } from 'axios';
import { useEffect, useMemo, useState } from 'react';

import { ApiEndpoints } from '@lib/enums/ApiEndpoints';
import { apiUrl } from '@lib/functions/Api';
import { useApi } from '../../contexts/ApiContext';

type PartUsageRowError = {
  code: string;
  value?: unknown;
  expected?: number;
  actual?: number;
  segments?: number[];
};

type PartUsageInvalidRow = {
  row: number;
  single_usage: unknown;
  designators: string;
  designator_count: number;
  errors: PartUsageRowError[];
};

type PartUsageWorkbookError = {
  code: string;
  field?: string;
  columns?: string[];
  column?: string;
  expected?: string;
  actual?: unknown;
};

type PartUsageCheckResult = {
  status: 'valid' | 'invalid' | 'sheet_selection_required';
  sheets: string[];
  sheet: string | null;
  checked_rows: number;
  workbook_errors: PartUsageWorkbookError[];
  invalid_rows: PartUsageInvalidRow[];
};

type ApiErrorPayload = {
  code?: string;
  message?: string;
};

const LONG_DESIGNATOR_COUNT = 20;
const LONG_DESIGNATOR_TEXT_LENGTH = 120;

const apiErrorMessages: Record<string, string> = {
  source_file_required: '请选择要检验的 Excel 文件。',
  invalid_file_type: '仅支持 .xlsx 格式的 Excel 文件。',
  invalid_sheet_name: '选择的工作表无效。',
  workbook_too_large: '文件超过 25 MiB 限制。',
  workbook_too_many_cells: '文件单元格数量超过检验限制。',
  workbook_too_many_rows: '文件数据行数超过检验限制。',
  workbook_has_no_populated_rows: '文件中没有可检验的数据。',
  invalid_xlsx: '无法读取该 Excel 文件，请确认文件未损坏。',
  worksheet_not_found: '未找到所选工作表。'
};

function fieldName(field?: string) {
  if (field === 'single_usage') return '单机用量';
  if (field === 'designators') return '位号';
  return '目标字段';
}

function workbookErrorText(error: PartUsageWorkbookError) {
  if (error.code === 'missing_header') {
    return `缺少“${fieldName(error.field)}”表头`;
  }
  if (error.code === 'invalid_header') {
    const column = error.column ?? fieldName(error.field);
    const expected = error.expected ?? fieldName(error.field);
    return `${column} 列表头必须为“${expected}”，当前为“${displayValue(error.actual)}”`;
  }
  if (error.code === 'no_data_rows') {
    return '表头下没有可检验的数据行';
  }
  return '工作表结构不符合要求';
}

function rowErrorText(error: PartUsageRowError) {
  switch (error.code) {
    case 'invalid_single_usage':
      return `单机用量必须为空或非负整数（当前为“${displayValue(error.value)}”）`;
    case 'missing_single_usage':
      return `单机用量为空，但填了 ${error.actual ?? 0} 个位号`;
    case 'invalid_designator_separator':
      return `位号第 ${(error.segments ?? []).join('、')} 段为空`;
    case 'designator_count_mismatch':
      return `数量不一致：单机用量 ${error.expected ?? '-'}，位号 ${error.actual ?? 0} 个`;
    default:
      return '该行不符合检验规则';
  }
}

function displayValue(value: unknown) {
  if (value === null || value === undefined || value === '') return '空';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function apiErrorText(error: unknown) {
  if (isAxiosError<ApiErrorPayload>(error)) {
    const payload = error.response?.data;
    if (payload?.code && apiErrorMessages[payload.code]) {
      return apiErrorMessages[payload.code];
    }
    if (payload?.message) return payload.message;
  }
  return '检验请求失败，请稍后重试。';
}

export default function PartUsageCheckModal({
  opened,
  onClose
}: Readonly<{
  opened: boolean;
  onClose: () => void;
}>) {
  const api = useApi();
  const [file, setFile] = useState<File | null>(null);
  const [sheetName, setSheetName] = useState<string | null>(null);
  const [result, setResult] = useState<PartUsageCheckResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [expandedDesignators, setExpandedDesignators] = useState<Set<number>>(
    new Set()
  );

  useEffect(() => {
    if (!opened) return;
    setFile(null);
    setSheetName(null);
    setResult(null);
    setError('');
    setLoading(false);
    setExpandedDesignators(new Set());
  }, [opened]);

  const requiresSheet =
    result?.status === 'sheet_selection_required' ||
    (result?.sheets.length ?? 0) > 1;
  const canCheck =
    !!file &&
    !loading &&
    (!requiresSheet ||
      result?.status !== 'sheet_selection_required' ||
      !!sheetName);

  const sheetOptions = useMemo(
    () => (result?.sheets ?? []).map((name) => ({ value: name, label: name })),
    [result?.sheets]
  );

  async function checkWorkbook() {
    if (!file || loading) return;
    if (requiresSheet && !sheetName) return;

    setLoading(true);
    setError('');
    setExpandedDesignators(new Set());
    const body = new FormData();
    body.append('source_file', file);
    if (sheetName) body.append('sheet_name', sheetName);

    try {
      const response = await api.post<PartUsageCheckResult>(
        apiUrl(ApiEndpoints.cangxu_part_usage_check),
        body
      );
      setResult(response.data);
      if (response.data.status === 'sheet_selection_required') {
        setSheetName(null);
      }
    } catch (requestError) {
      setResult(null);
      setError(apiErrorText(requestError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={loading ? () => {} : onClose}
      title='物料检验'
      size='xl'
      centered
      closeOnClickOutside={!loading}
      closeOnEscape={!loading}
    >
      <Stack gap='md'>
        <Text size='sm' c='dimmed'>
          上传物料 Excel
          表格。系统检查第一行的“单机用量”和“位号”表头，以及每行位号数量是否与单机用量一致。
        </Text>

        <Group>
          <Button
            component='a'
            href={apiUrl(ApiEndpoints.cangxu_part_usage_check)}
            download='物料检验标准格式.xlsx'
            variant='light'
            leftSection={<IconDownload size={16} />}
          >
            下载标准格式表格
          </Button>
        </Group>

        <FileInput
          label='Excel 文件'
          description='仅支持 .xlsx，文件不会保存或写入业务数据。'
          placeholder='选择物料表格'
          accept='.xlsx'
          leftSection={<IconFileSpreadsheet />}
          value={file}
          onChange={(selectedFile) => {
            setFile(selectedFile);
            setSheetName(null);
            setResult(null);
            setError('');
            setExpandedDesignators(new Set());
          }}
          clearable
        />

        {requiresSheet && (
          <Select
            label='工作表'
            placeholder='请选择要检验的工作表'
            data={sheetOptions}
            value={sheetName}
            onChange={(value) => {
              setSheetName(value);
              setError('');
            }}
            searchable
            allowDeselect={false}
          />
        )}

        <Group justify='flex-end'>
          <Button
            leftSection={<IconUpload size={16} />}
            loading={loading}
            disabled={!canCheck}
            onClick={() => void checkWorkbook()}
          >
            {result?.status === 'sheet_selection_required'
              ? '检验所选工作表'
              : result
                ? '重新检验'
                : '开始检验'}
          </Button>
        </Group>

        {error && (
          <Alert color='red' title='检验未完成' role='alert'>
            {error}
          </Alert>
        )}

        {result?.status === 'valid' && (
          <Alert
            color='green'
            title='表格有效'
            icon={<IconCircleCheck />}
          >
            工作表“{result.sheet}”共检查 {result.checked_rows}{' '}
            行，全部符合规则。
          </Alert>
        )}

        {result && result.workbook_errors.length > 0 && (
          <Alert color='red' title='工作表不符合要求'>
            <Stack gap={4}>
              {result.workbook_errors.map((workbookError, index) => (
                <Text size='sm' key={`${workbookError.code}-${index}`}>
                  {workbookErrorText(workbookError)}
                </Text>
              ))}
            </Stack>
          </Alert>
        )}

        {result && result.invalid_rows.length > 0 && (
          <Stack gap='xs'>
            <Group
              justify='space-between'
              align='center'
              gap='sm'
              wrap='wrap'
              role='status'
              aria-label='不合格行摘要'
            >
              <Group gap='xs'>
                <Badge color='red' variant='filled' size='sm'>
                  不合格
                </Badge>
                <Text size='sm' fw={600}>
                  工作表“{result.sheet}”
                </Text>
              </Group>
              <Group gap='md'>
                <Text size='sm' c='dimmed'>
                  检查 {result.checked_rows} 行
                </Text>
                <Text size='sm' c='red' fw={600}>
                  {result.invalid_rows.length} 行不合格
                </Text>
              </Group>
            </Group>
            <ScrollArea.Autosize mah={420} type='auto'>
              <Table.ScrollContainer minWidth={760}>
                <Table
                  striped
                  withTableBorder
                  stickyHeader
                  verticalSpacing='xs'
                  horizontalSpacing='sm'
                >
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th style={{ width: 72 }}>行号</Table.Th>
                      <Table.Th style={{ minWidth: 260 }}>不合格原因</Table.Th>
                      <Table.Th style={{ width: 110 }}>单机用量</Table.Th>
                      <Table.Th style={{ minWidth: 280 }}>位号</Table.Th>
                      <Table.Th style={{ width: 100 }}>位号数量</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {result.invalid_rows.map((row) => {
                      const isLong =
                        row.designator_count > LONG_DESIGNATOR_COUNT ||
                        row.designators.length > LONG_DESIGNATOR_TEXT_LENGTH;
                      const isExpanded = expandedDesignators.has(row.row);

                      return (
                        <Table.Tr
                          key={row.row}
                          style={{ verticalAlign: 'top' }}
                        >
                          <Table.Td>
                            <Text size='sm' fw={600}>
                              {row.row}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Stack gap={4}>
                              {row.errors.map((rowError, index) => (
                                <Group
                                  gap={6}
                                  align='flex-start'
                                  wrap='nowrap'
                                  key={`${row.row}-${rowError.code}-${index}`}
                                >
                                  <IconAlertCircle
                                    size={14}
                                    color='var(--mantine-color-red-6)'
                                    style={{ marginTop: 2, flexShrink: 0 }}
                                  />
                                  <Text
                                    size='sm'
                                    c='red'
                                    style={{ lineHeight: 1.4 }}
                                  >
                                    {rowErrorText(rowError)}
                                  </Text>
                                </Group>
                              ))}
                            </Stack>
                          </Table.Td>
                          <Table.Td>
                            <Text size='sm' fw={500}>
                              {displayValue(row.single_usage)}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Stack gap={4} align='flex-start'>
                              <Text
                                size='sm'
                                data-testid={`part-usage-designators-${row.row}`}
                                lineClamp={
                                  isLong && !isExpanded ? 3 : undefined
                                }
                                style={{
                                  whiteSpace: 'pre-wrap',
                                  wordBreak: 'break-word',
                                  lineHeight: 1.5
                                }}
                              >
                                {row.designators || '空'}
                              </Text>
                              {isLong && (
                                <Button
                                  variant='subtle'
                                  size='compact-sm'
                                  px={0}
                                  aria-expanded={isExpanded}
                                  onClick={() =>
                                    setExpandedDesignators((current) => {
                                      const next = new Set(current);
                                      if (next.has(row.row)) {
                                        next.delete(row.row);
                                      } else {
                                        next.add(row.row);
                                      }
                                      return next;
                                    })
                                  }
                                >
                                  {isExpanded
                                    ? '收起'
                                    : `展开全部（${row.designator_count} 个）`}
                                </Button>
                              )}
                            </Stack>
                          </Table.Td>
                          <Table.Td>
                            <Badge color='red' variant='light' radius='sm'>
                              {row.designator_count}
                            </Badge>
                          </Table.Td>
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </ScrollArea.Autosize>
          </Stack>
        )}
      </Stack>
    </Modal>
  );
}
