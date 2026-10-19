import '@mantine/core/styles.css';
import { MantineProvider } from '@mantine/core';
import { QueryClient } from '@tanstack/react-query';
import type { AxiosInstance } from 'axios';
import { createRoot } from 'react-dom/client';
import { ApiProvider } from '../../src/contexts/ApiContext';
import PartUsageCheckModal from '../../src/components/modals/PartUsageCheckModal';

const calls: { sheetName: string | null; filename: string }[] = [];
Object.assign(window, { __partUsageCheckCalls: calls });

function selectionRequired() {
  return {
    status: 'sheet_selection_required',
    sheets: ['合成第一页', '合成第二页'],
    sheet: null,
    checked_rows: 0,
    workbook_errors: [],
    invalid_rows: []
  };
}

function invalidRows(sheet: string) {
  return {
    status: 'invalid',
    sheets: ['合成第一页', '合成第二页'],
    sheet,
    checked_rows: 2,
    workbook_errors: [],
    invalid_rows: [
      {
        row: 2,
        single_usage: 2,
        designators: 'C1,C2,C3',
        designator_count: 3,
        row_values: { A: 'C1,C2,C3', B: 2, C: 'CX-SYN-001' },
        errors: [
          {
            code: 'designator_count_mismatch',
            expected: 2,
            actual: 3
          }
        ]
      },
      {
        row: 4,
        single_usage: 2,
        designators: 'C1,,C2',
        designator_count: 2,
        row_values: { A: 'C1,,C2', B: 2, C: 'CX-SYN-002' },
        errors: [
          {
            code: 'invalid_designator_separator',
            segments: [2]
          }
        ]
      }
    ]
  };
}

function validRows(sheet: string) {
  return {
    status: 'valid',
    sheets: ['合成第一页', '合成第二页'],
    sheet,
    checked_rows: 2,
    workbook_errors: [],
    invalid_rows: []
  };
}

function invalidHeader() {
  return {
    status: 'invalid',
    sheets: ['合成第一页'],
    sheet: '合成第一页',
    checked_rows: 0,
    workbook_errors: [
      {
        code: 'invalid_header',
        field: 'single_usage',
        column: 'B',
        expected: '单机用量',
        actual: '用量'
      }
    ],
    invalid_rows: []
  };
}

const longDesignators = Array.from(
  { length: 25 },
  (_, index) => `R${index + 1}`
).join(',');

function longDesignatorRows() {
  return {
    status: 'invalid',
    sheets: ['合成第一页'],
    sheet: '合成第一页',
    checked_rows: 1,
    workbook_errors: [],
    invalid_rows: [
      {
        row: 2,
        single_usage: 24,
        designators: longDesignators,
        designator_count: 25,
        errors: [
          {
            code: 'designator_count_mismatch',
            expected: 24,
            actual: 25
          }
        ]
      }
    ]
  };
}

const api = {
  post: async (_url: string, body: FormData) => {
    const file = body.get('source_file');
    const filename = file instanceof File ? file.name : '';
    const sheet = body.get('sheet_name');
    const sheetName = typeof sheet === 'string' ? sheet : null;
    calls.push({
      sheetName,
      filename
    });
    if (filename.includes('long-designators')) {
      return { data: longDesignatorRows() };
    }
    if (filename.includes('invalid-header')) {
      return { data: invalidHeader() };
    }
    if (!sheetName) return { data: selectionRequired() };
    if (sheetName === '合成第一页') {
      return { data: invalidRows(sheetName) };
    }
    return { data: validRows(sheetName) };
  }
} as unknown as AxiosInstance;

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } }
});

createRoot(document.getElementById('root')!).render(
  <MantineProvider>
    <ApiProvider api={api} client={client}>
      <PartUsageCheckModal opened onClose={() => {}} />
    </ApiProvider>
  </MantineProvider>
);
