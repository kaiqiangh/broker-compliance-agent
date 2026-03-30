export interface PIIToken {
  token: string;
  original: string;
  type: string;
}

export interface DesensitizeResult {
  desensitized: string;
  tokens: PIIToken[];
}

export function desensitizePII(text: string): DesensitizeResult {
  const tokens: PIIToken[] = [];
  let result = text;
  let counter = 0;

  // Email addresses
  result = result.replace(
    /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    (match) => {
      const token = `{EMAIL_${++counter}}`;
      tokens.push({ token, original: match, type: 'email' });
      return token;
    }
  );

  // Irish phone numbers (+353 or 0 followed by 8-9 digits)
  result = result.replace(
    /(\+353\d{8,9}|0\d{8,9})\b/g,
    (match) => {
      // Don't re-tokenize tokens we just created
      if (match.includes('{')) return match;
      const token = `{PHONE_${++counter}}`;
      tokens.push({ token, original: match, type: 'phone' });
      return token;
    }
  );

  // Policy numbers (alphanumeric with dashes/slashes, 6-20 chars)
  result = result.replace(
    /\b[A-Z]{2,4}[-/]?\d{4,10}[-/]?\d{0,6}\b/g,
    (match) => {
      if (match.includes('{')) return match;
      const token = `{POLICY_${++counter}}`;
      tokens.push({ token, original: match, type: 'policy_number' });
      return token;
    }
  );

  // PPS numbers (7 digits + 1-2 letters)
  result = result.replace(
    /\b\d{7}[A-Z]{1,2}\b/g,
    (match) => {
      if (match.includes('{')) return match;
      const token = `{PPS_${++counter}}`;
      tokens.push({ token, original: match, type: 'pps' });
      return token;
    }
  );

  // Date of birth (only near DOB keyword)
  result = result.replace(
    /(DOB|date of birth|born|birth\s*date)[\s:]*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/gi,
    (match, keyword, date) => {
      if (date.includes('{')) return match;
      const token = `{DOB_${++counter}}`;
      tokens.push({ token, original: date, type: 'dob' });
      return `${keyword}: ${token}`;
    }
  );

  // Person names — heuristic: "client/policyholder/insured" followed by capitalized words
  result = result.replace(
    /(client|policyholder|insured|member|beneficiary)[\s:]+([A-Z][a-zàáâäãåèéêëìíîïòóôöõùúûüýÿ]+(?:\s+(?:[A-Z][a-zàáâäãåèéêëìíîïòóôöõùúûüýÿ]+|Ó|Mac|Mc|O'|De|Van|Van der)\w*){0,3})/gi,
    (match, keyword, name) => {
      if (name.includes('{')) return match;
      // Don't replace very short "names" or common non-names
      if (name.length < 3 || ['Ireland', 'Insurance', 'Broker', 'Policy', 'Renewal', 'Claim', 'Your', 'Dear'].includes(name)) {
        return match;
      }
      const token = `{CLIENT_NAME_${++counter}}`;
      tokens.push({ token, original: name, type: 'name' });
      return `${keyword}: ${token}`;
    }
  );

  // Irish addresses — heuristic: number + street name + common suffixes
  result = result.replace(
    /(\d{1,3}[A-Za-z]?\s+[A-Z][a-zàáâäãåèéêëìíîïòóôöõùúûüýÿ]+(?:\s+[A-Z][a-zàáâäãåèéêëìíîïòóôöõùúûüýÿ]+)*\s+(?:Street|Road|Avenue|Lane|Drive|Close|Court|Place|Terrace|Park|Grove|Way|Square|Crescent|Quay|Row|Hill|View|Lodge|Rise|Walk|Green|Gate|Mews)(?:,\s*[A-Z][a-z]+)*)/g,
    (match) => {
      if (match.includes('{')) return match;
      if (match.length < 10) return match;
      const token = `{ADDRESS_${++counter}}`;
      tokens.push({ token, original: match, type: 'address' });
      return token;
    }
  );

  return { desensitized: result, tokens };
}

export function resensitize(data: any, tokens: PIIToken[]): any {
  if (data === null || data === undefined) return data;

  const tokenMap = new Map(tokens.map((t) => [t.token, t.original]));

  const json = JSON.stringify(data);
  const restored = json.replace(/\{[A-Z_]+\d+\}/g, (match) => {
    return tokenMap.get(match) || match;
  });

  return JSON.parse(restored);
}
