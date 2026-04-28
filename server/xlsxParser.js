const XLSX = require('xlsx');

/**
 * Parse XLSX file and return rows as objects
 * Supports: email, name, position, company, company size, industry, job function
 */
function parseXlsx(buffer) {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 });
  
  if (rows.length < 2) return [];
  
  const headers = rows[0].map(h => (h || '').toString().trim().toUpperCase());
  
  // Map column indices
  const colMap = {
    email: findCol(headers, ['EMAIL', 'E-MAIL']),
    name: findCol(headers, ['NAME', 'FULL NAME']),
    position: findCol(headers, ['POSITION', 'TITLE', 'JOB TITLE', 'ROLE']),
    company: findCol(headers, ['COMPANY', 'COMPANY NAME', 'ORGANIZATION']),
    companySize: findCol(headers, ['COMPANY SIZE', 'SIZE', 'EMPLOYEES']),
    industry: findCol(headers, ['INDUSTRY', 'SECTOR']),
    jobFunction: findCol(headers, ['JOB FUNCTION', 'FUNCTION', 'DEPARTMENT'])
  };
  
  const result = [];
  
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(cell => !cell)) continue;
    
    const profile = {
      rowNumber: i + 1,
      email: getVal(row, colMap.email),
      name: getVal(row, colMap.name),
      position: getVal(row, colMap.position),
      company: getVal(row, colMap.company),
      companySize: getVal(row, colMap.companySize),
      industry: getVal(row, colMap.industry),
      jobFunction: getVal(row, colMap.jobFunction),
    };
    
    if (profile.name || profile.email) {
      result.push(profile);
    }
  }
  
  return result;
}

/**
 * Parse a pasted line like:
 * email\tName\tPosition\tCompany\tSize\tIndustry\tJobFunction
 */
function parsePastedLine(line) {
  // Support tab, pipe, or multi-space as delimiter
  const parts = line.includes('\t') 
    ? line.split('\t') 
    : line.split(/\s{2,}|\|/);
  
  const clean = parts.map(p => p.trim());
  
  return {
    email: clean[0] || '',
    name: clean[1] || '',
    position: clean[2] || '',
    company: clean[3] || '',
    companySize: clean[4] || '',
    industry: clean[5] || '',
    jobFunction: clean[6] || '',
  };
}

function findCol(headers, possibleNames) {
  for (const name of possibleNames) {
    const idx = headers.indexOf(name);
    if (idx !== -1) return idx;
  }
  // Partial match
  for (const name of possibleNames) {
    const idx = headers.findIndex(h => h.includes(name));
    if (idx !== -1) return idx;
  }
  return -1;
}

function getVal(row, colIdx) {
  if (colIdx === -1 || colIdx >= row.length) return '';
  const val = row[colIdx];
  return val !== undefined && val !== null ? val.toString().trim() : '';
}

module.exports = { parseXlsx, parsePastedLine };
