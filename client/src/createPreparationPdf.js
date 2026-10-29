const SECTION_HEADINGS = new Set([
  'APPOINTMENT PREPARATION',
  'MAIN CONCERN',
  'NOTES TO DISCUSS',
  'CURRENT MEDICINES',
  'ALLERGIES',
  'MY QUESTIONS',
  'QUESTIONS TO CONSIDER',
]);

function isSectionHeading(line) {
  return SECTION_HEADINGS.has(line) || (/^[A-Z][A-Z\s-]{2,48}$/.test(line) && !line.startsWith('VISIT:'));
}

export async function downloadPreparationPdf(summary) {
  const { jsPDF } = await import('jspdf');
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4', compress: true });
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const margin = 52;
  const contentWidth = pageWidth - margin * 2;
  const footerLimit = pageHeight - 56;
  let y = 0;

  pdf.setProperties({
    title: 'ClinicPrep Visit Preparation',
    subject: 'Appointment preparation notes',
    author: 'ClinicPrep',
    creator: 'ClinicPrep',
  });

  function drawPageHeader(firstPage = false) {
    if (firstPage) {
      pdf.setFillColor(20, 125, 115);
      pdf.roundedRect(margin, 40, 28, 28, 7, 7, 'F');
      pdf.setTextColor(255, 255, 255);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(16);
      pdf.text('+', margin + 8, 60);
      pdf.setTextColor(32, 54, 53);
      pdf.setFontSize(14);
      pdf.text('ClinicPrep', margin + 37, 52);
      pdf.setTextColor(112, 129, 125);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(9);
      pdf.text('VISIT PREPARATION', margin + 37, 66);
      pdf.setTextColor(32, 54, 53);
      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(22);
      pdf.text('Appointment notes', margin, 111);
      pdf.setDrawColor(220, 232, 227);
      pdf.setLineWidth(1);
      pdf.line(margin, 126, pageWidth - margin, 126);
      return 151;
    }

    pdf.setTextColor(20, 125, 115);
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(10);
    pdf.text('ClinicPrep', margin, 34);
    pdf.setTextColor(112, 129, 125);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.text('VISIT PREPARATION - CONTINUED', pageWidth - margin, 34, { align: 'right' });
    pdf.setDrawColor(220, 232, 227);
    pdf.line(margin, 44, pageWidth - margin, 44);
    return 64;
  }

  y = drawPageHeader(true);

  function ensureSpace(height) {
    if (y + height > footerLimit) {
      pdf.addPage();
      y = drawPageHeader(false);
    }
  }

  function drawBodyLine(line) {
    const bullet = /^\s*[•*-]\s+/.test(line);
    const content = bullet ? line.replace(/^\s*[•*-]\s+/, '') : line;
    const bulletIndent = bullet ? 16 : 0;
    const wrapWidth = contentWidth - bulletIndent;

    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(10.5);
    pdf.setTextColor(49, 67, 63);
    const wrapped = pdf.splitTextToSize(content, wrapWidth);
    const lineHeight = 15;
    ensureSpace(wrapped.length * lineHeight + 2);

    if (bullet) {
      pdf.setFillColor(20, 125, 115);
      pdf.circle(margin + 3, y - 3, 2, 'F');
    }
    pdf.text(wrapped, margin + bulletIndent, y, { lineHeightFactor: 1.35 });
    y += wrapped.length * lineHeight + 2;
  }

  function drawHeading(line) {
    ensureSpace(31);
    y += line === 'APPOINTMENT PREPARATION' ? 1 : 7;
    pdf.setFont('helvetica', 'bold');
    pdf.setFontSize(line === 'APPOINTMENT PREPARATION' ? 10 : 9);
    pdf.setTextColor(20, 125, 115);
    pdf.text(line, margin, y);
    y += line === 'APPOINTMENT PREPARATION' ? 17 : 16;
  }

  function drawDisclaimer(line) {
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(9);
    const wrapped = pdf.splitTextToSize(line, contentWidth - 22);
    const boxHeight = wrapped.length * 13 + 18;
    ensureSpace(boxHeight + 5);
    pdf.setFillColor(239, 247, 244);
    pdf.setDrawColor(218, 235, 228);
    pdf.roundedRect(margin, y - 3, contentWidth, boxHeight, 5, 5, 'FD');
    pdf.setTextColor(76, 105, 96);
    pdf.text(wrapped, margin + 11, y + 10, { lineHeightFactor: 1.3 });
    y += boxHeight + 7;
  }

  const lines = String(summary || '').replace(/\r/g, '').split('\n');
  for (const rawLine of lines) {
    const line = rawLine.trim();
    const displayLine = line.startsWith('Visit:') ? rawLine.replace(' · ', ' - ') : rawLine;
    if (!line) {
      y += 4;
      continue;
    }
    if (/^(this organizational draft|this draft organizes|this is an organizational)/i.test(line)) {
      drawDisclaimer(line);
    } else if (isSectionHeading(line)) {
      drawHeading(line);
    } else {
      drawBodyLine(displayLine);
    }
  }

  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(228, 236, 232);
    pdf.line(margin, pageHeight - 42, pageWidth - margin, pageHeight - 42);
    pdf.setFont('helvetica', 'normal');
    pdf.setFontSize(8);
    pdf.setTextColor(129, 145, 140);
    pdf.text('ClinicPrep - For discussion with your healthcare professional', margin, pageHeight - 26);
    pdf.text(`Page ${page} of ${pageCount}`, pageWidth - margin, pageHeight - 26, { align: 'right' });
  }

  pdf.save('ClinicPrep_Visit_Preparation.pdf');
}
