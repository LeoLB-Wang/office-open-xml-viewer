//! OPC part lookup for ZIPs embedded in legacy binary records.
//!
//! ECMA-376 Part 2 §6.2.2.3 gives part names ASCII case and RFC 3986
//! percent-encoding equivalence. Reject an ambiguous embedded ZIP rather than
//! choosing whichever duplicate its index happens to return.

pub(crate) fn entry_index<R: std::io::Read + std::io::Seek>(
    archive: &zip::ZipArchive<R>,
    path: &str,
) -> Option<usize> {
    let key = ooxml_common::rels::part_name_equivalence_key(path);
    let mut found = None;
    for name in archive.file_names() {
        if ooxml_common::rels::part_name_equivalence_key(name) == key {
            if found.is_some() {
                return None;
            }
            found = archive.index_for_name(name);
        }
    }
    found
}

mod reader;
pub(crate) use reader::Entry;

/// A valid ZIP with many empty DEFLATE stored blocks before its final output.
#[cfg(test)]
pub(crate) fn test_empty_deflate(name: &str, blocks: usize, output: &[u8]) -> Vec<u8> {
    use std::io::Write;
    let mut writer = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    writer
        .start_file(
            name,
            zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated),
        )
        .unwrap();
    writer.write_all(output).unwrap();
    let mut bytes = writer.finish().unwrap().into_inner();
    let central = bytes.windows(4).position(|s| s == b"PK\x01\x02").unwrap();
    let data = 30
        + u16::from_le_bytes(bytes[26..28].try_into().unwrap()) as usize
        + u16::from_le_bytes(bytes[28..30].try_into().unwrap()) as usize;
    let length = u16::try_from(output.len()).unwrap();
    let mut encoded = [0, 0, 0, 255, 255].repeat(blocks);
    let last = (blocks - 1) * 5;
    encoded[last] = 1; // BFINAL; earlier blocks produce no output.
    encoded[last + 1..last + 3].copy_from_slice(&length.to_le_bytes());
    encoded[last + 3..last + 5].copy_from_slice(&(!length).to_le_bytes());
    encoded.extend_from_slice(output);
    bytes.splice(data..central, encoded.iter().copied());
    let central = data + encoded.len();
    bytes[18..22].copy_from_slice(&(encoded.len() as u32).to_le_bytes());
    bytes[central + 20..central + 24].copy_from_slice(&(encoded.len() as u32).to_le_bytes());
    let footer = bytes.len() - 22;
    bytes[footer + 16..footer + 20].copy_from_slice(&(central as u32).to_le_bytes());
    bytes
}
