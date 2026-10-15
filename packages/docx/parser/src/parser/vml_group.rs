//! VML group coordinate adapter (ECMA-376 Part 4 §19.1.2.7/§19.1.2.19).
//! Group children are expressed in the parent's coordsize/coordorigin space,
//! not page points. The shared drawing transform maps their boxes and composes
//! clockwise rotations/reflections without Word-specific DrawingML heuristics.
use super::*;

const VML: &str = "urn:schemas-microsoft-com:vml";

fn unsupported(diagnostics: &mut Vec<PendingParseDiagnostic>) {
    push_pending_parse_diagnostic(
        diagnostics,
        PARSE_DIAGNOSTIC_CODE_UNSUPPORTED_VML_CONTENT,
        PARSE_DIAGNOSTIC_SEVERITY_UNSUPPORTED_VML_CONTENT,
    );
}

fn pair(raw: &str) -> Option<(f64, f64)> {
    let mut values = raw
        .split(|c: char| c == ',' || c.is_whitespace())
        .filter(|s| !s.is_empty());
    let x = values.next()?.parse::<f64>().ok()?;
    let y = values.next()?.parse::<f64>().ok()?;
    (x.is_finite() && y.is_finite() && values.next().is_none()).then_some((x, y))
}

fn group_spec(group: roxmltree::Node, root: bool) -> Option<DrawingGroupSpec> {
    let style = group.attribute("style").unwrap_or("");
    let (cx, cy) = pair(group.attribute("coordsize").unwrap_or("1000,1000"))?;
    let (ox, oy) = pair(group.attribute("coordorigin").unwrap_or("0,0"))?;
    let width = vml_css_length_pt(style, "width")?;
    let height = vml_css_length_pt(style, "height")?;
    let flip = vml_css_str(style, "flip").unwrap_or_default();
    let spec = DrawingGroupSpec {
        off_x: if root {
            0.0
        } else {
            vml_css_length_pt(style, "left").unwrap_or(0.0)
        },
        off_y: if root {
            0.0
        } else {
            vml_css_length_pt(style, "top").unwrap_or(0.0)
        },
        ext_x: width,
        ext_y: height,
        child_off_x: ox,
        child_off_y: oy,
        child_ext_x: cx,
        child_ext_y: cy,
        rotation_degrees: if root {
            0.0
        } else {
            vml_css_length_pt(style, "rotation").unwrap_or(0.0)
        },
        flip_h: !root && flip.contains('x'),
        flip_v: !root && flip.contains('y'),
    };
    (width.is_finite()
        && height.is_finite()
        && width > 0.0
        && height > 0.0
        && cx > 0.0
        && cy > 0.0
        && spec.off_x.is_finite()
        && spec.off_y.is_finite()
        && spec.rotation_degrees.is_finite())
    .then_some(spec)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn parse_groups(
    style_map: &StyleMap,
    num_map: &mut NumberingMap,
    pict: roxmltree::Node,
    theme: &ThemeColors,
    media_map: &HashMap<String, String>,
    chart_map: &ChartMap,
    rel_map: &HashMap<String, String>,
    depth: DepthGuard,
    document_diagnostics: &mut Vec<PendingParseDiagnostic>,
) -> Option<Vec<DocRun>> {
    if !pict.children().any(|n| n.has_tag_name((VML, "group"))) {
        return None;
    }
    // Resolve definitions once per pict, not once per leaf in large groups.
    let shape_types: HashMap<_, _> = pict
        .descendants()
        .filter(|n| n.has_tag_name((VML, "shapetype")))
        .filter_map(|n| n.attribute("id").map(|id| (id, n)))
        .collect();
    let mut result = Vec::new();
    for group in pict.children().filter(|n| n.is_element()) {
        if group.has_tag_name((VML, "shapetype")) {
            continue;
        }
        if !group.has_tag_name((VML, "group")) {
            // A pict may contain siblings beside its groups. Preserve their
            // ordinary picture/panel path instead of making group detection
            // an exclusive choice that loses otherwise supported siblings.
            if let Some(image) = parse_vml_pict_image(group, media_map) {
                result.push(DocRun::Image(Box::new(image)));
            } else if matches!(
                group.tag_name().name(),
                "shape" | "rect" | "roundrect" | "oval" | "line"
            ) {
                let definition = group
                    .attribute("type")
                    .and_then(|id| shape_types.get(id.trim_start_matches('#')))
                    .copied();
                if let Some(shape) = parse_vml_shape(
                    style_map, num_map, group, definition, theme, media_map, chart_map, rel_map,
                    depth,
                ) {
                    result.push(DocRun::Shape(Box::new(shape)));
                } else {
                    unsupported(document_diagnostics);
                }
            } else {
                unsupported(document_diagnostics);
            }
            continue;
        }
        let Some(spec) = group_spec(group, true) else {
            unsupported(document_diagnostics);
            continue;
        };
        let mut group_diagnostics = Vec::new();
        let diagnostics = &mut group_diagnostics;
        let mut children = Vec::new();
        let mut pending = vec![(group, GroupTransform::from_group(spec))];
        while let Some((parent, transform)) = pending.pop() {
            // A stack frame per group avoids recursive parser calls. Reverse
            // insertion preserves authored painter order across nested groups.
            if parent.has_tag_name((VML, "group")) {
                let mut ordered_children: Vec<_> =
                    parent.children().filter(|n| n.is_element()).collect();
                // §19.1.2.19: signed z-index controls overlap. Stable sorting
                // keeps source order for equal/default indices, and a nested
                // group remains one stacking unit before its children expand.
                ordered_children.sort_by_key(|child| {
                    let style = child.attribute("style").unwrap_or("");
                    match vml_css_str(style, "z-index").unwrap_or("0").parse::<i32>() {
                        Ok(index) => index,
                        Err(_) => {
                            unsupported(diagnostics);
                            0
                        }
                    }
                });
                for child in ordered_children.into_iter().rev() {
                    if child.has_tag_name((VML, "group")) {
                        if let Some(spec) = group_spec(child, false) {
                            pending.push((child, transform.compose_group(spec)));
                        } else {
                            unsupported(diagnostics);
                        }
                    } else {
                        pending.push((child, transform));
                    }
                }
                // The group itself is only a coordinate container.
                continue;
            }
            let child = parent;
            if child.tag_name().namespace() != Some(VML) {
                // Lock/wrap/anchorlock and editor metadata have no independent
                // ink. Other Office extensions (diagram, skew, extrusion, etc.)
                // are not implemented and must be disclosed.
                if !matches!(
                    child.tag_name().name(),
                    "lock" | "wrap" | "anchorlock" | "ClientData"
                ) {
                    unsupported(diagnostics);
                }
                continue;
            }
            match child.tag_name().name() {
                "shapetype" => continue,
                "shape" | "rect" | "roundrect" | "oval" | "line" | "image" => {}
                // CT_Group also admits arc, curve, polyline and EG_ShapeElements
                // (path/formulas/handles/fill/stroke/shadow/textbox/textpath/
                // imagedata). Their standalone group-level drawing semantics
                // are not represented by the DOCX model. Never guess a rect.
                _ => {
                    unsupported(diagnostics);
                    continue;
                }
            }
            let style = child.attribute("style").unwrap_or("");
            let imagedata = child
                .children()
                .find(|n| n.has_tag_name((VML, "imagedata")));
            let mut run = if let Some(image) = imagedata {
                let path = attr_ns(
                    &image,
                    relationships::TRANSITIONAL,
                    relationships::STRICT,
                    "id",
                )
                .or_else(|| {
                    image
                        .attributes()
                        .find(|a| a.name() == "relid")
                        .map(|a| a.value())
                })
                .and_then(|rid| media_map.get(rid));
                let (Some(path), Some(width), Some(height)) = (
                    path,
                    vml_css_length_pt(style, "width"),
                    vml_css_length_pt(style, "height"),
                ) else {
                    unsupported(diagnostics);
                    continue;
                };
                DocRun::Image(Box::new(vml_image_run(child, path.clone(), width, height)))
            } else {
                // Arbitrary VML paths/formulas and non-interoperable spt values
                // have no geometry adapter yet. Existing preset equivalents
                // remain available; unsupported geometry is explicit.
                let shape_type = child
                    .attribute("type")
                    .and_then(|id| shape_types.get(id.trim_start_matches('#')))
                    .copied();
                let spt = child
                    .attributes()
                    .find(|a| a.name() == "spt")
                    .or_else(|| shape_type.and_then(|n| n.attributes().find(|a| a.name() == "spt")))
                    .and_then(|a| a.value().parse::<u16>().ok());
                let direct_path = child.attribute("path").is_some()
                    || vml_direct_child(child, "path").is_some_and(|n| n.attribute("v").is_some());
                let has_path = direct_path
                    || shape_type.is_some_and(|n| {
                        n.attribute("path").is_some()
                            || vml_direct_child(n, "path")
                                .is_some_and(|path| path.attribute("v").is_some())
                    });
                if child.tag_name().name() == "image"
                    || direct_path
                    || ((has_path || spt.is_some() || child.attribute("type").is_some())
                        && spt.and_then(vml_shape_type_preset).is_none())
                {
                    unsupported(diagnostics);
                    continue;
                }
                let Some(shape) = parse_vml_shape(
                    style_map, num_map, child, shape_type, theme, media_map, chart_map, rel_map,
                    depth,
                ) else {
                    unsupported(diagnostics);
                    continue;
                };
                DocRun::Shape(Box::new(shape))
            };
            let (x, y, width, height, rotation, flip_h, flip_v) = match &mut run {
                DocRun::Image(image) => {
                    image.anchor = true;
                    image.anchor_acquisition = None;
                    image.anchor_x_relative_from = Some("column".into());
                    image.anchor_y_relative_from = Some("paragraph".into());
                    (
                        &mut image.anchor_x_pt,
                        &mut image.anchor_y_pt,
                        &mut image.width_pt,
                        &mut image.height_pt,
                        &mut image.rotation,
                        &mut image.flip_h,
                        &mut image.flip_v,
                    )
                }
                DocRun::Shape(shape) => {
                    shape.anchor_acquisition = None;
                    shape.anchor_x_relative_from = Some("column".into());
                    shape.anchor_y_relative_from = Some("paragraph".into());
                    shape.z_order = children.len() as u32;
                    (
                        &mut shape.anchor_x_pt,
                        &mut shape.anchor_y_pt,
                        &mut shape.width_pt,
                        &mut shape.height_pt,
                        &mut shape.rotation,
                        &mut shape.flip_h,
                        &mut shape.flip_v,
                    )
                }
                _ => unreachable!(),
            };
            if child.tag_name().name() != "line" {
                *x = vml_css_length_pt(style, "left").unwrap_or(0.0);
                *y = vml_css_length_pt(style, "top").unwrap_or(0.0);
            }
            let rect = transform.apply_rect(DrawingRect {
                x: *x,
                y: *y,
                width: *width,
                height: *height,
                rotation_degrees: *rotation,
                flip_h: *flip_h,
                flip_v: *flip_v,
            });
            if ![
                rect.x,
                rect.y,
                rect.width,
                rect.height,
                rect.rotation_degrees,
            ]
            .iter()
            .all(|v| v.is_finite())
                || rect.width < 0.0
                || rect.height < 0.0
            {
                unsupported(diagnostics);
                continue;
            }
            *x = rect.x;
            *y = rect.y;
            *width = rect.width;
            *height = rect.height;
            *rotation = rect.rotation_degrees;
            *flip_h = rect.flip_h;
            *flip_v = rect.flip_v;
            children.push(run);
        }
        let style = group.attribute("style").unwrap_or("");
        let absolute = vml_css_str(style, "position") == Some("absolute");
        let mut wrapper = ShapeRun {
            inline: !absolute,
            width_pt: spec.ext_x,
            height_pt: spec.ext_y,
            rotation: vml_css_length_pt(style, "rotation").unwrap_or(0.0),
            flip_h: vml_css_str(style, "flip").is_some_and(|s| s.contains('x')),
            flip_v: vml_css_str(style, "flip").is_some_and(|s| s.contains('y')),
            text_box_content: vec![TextBoxBlockWire::Body(BodyElement::Paragraph(Box::new(
                DocParagraph {
                    alignment: "left".into(),
                    runs: children,
                    ..Default::default()
                },
            )))],
            ..Default::default()
        };
        // The group is represented as a retained text-box story, just like an
        // inline DrawingML group. Carry incomplete-content markers in that
        // story, so header/footer/note groups also reach DocumentLayout's
        // existing unsupported-block diagnostic collector (their paragraph
        // parsers do not publish body-only PendingParseDiagnostics).
        if !group_diagnostics.is_empty() {
            wrapper
                .text_box_content
                .push(TextBoxBlockWire::Unsupported {
                    kind: "unsupportedTextBoxBlock".into(),
                    q_name: "v:group".into(),
                    source_path: vec![1],
                });
        }
        if absolute {
            wrapper.anchor_acquisition = Some(vml_word_anchor_acquisition(
                group, style, spec.ext_x, spec.ext_y,
            ));
        }
        result.push(DocRun::Shape(Box::new(wrapper)));
    }
    Some(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parse(xml: &str) -> (ShapeRun, Vec<PendingParseDiagnostic>) {
        let xml = format!(
            r#"<w:pict xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">{xml}</w:pict>"#
        );
        let doc = XmlDoc::parse(&xml).unwrap();
        let mut diagnostics = Vec::new();
        let mut runs = parse_groups(
            &StyleMap::default(),
            &mut NumberingMap::default(),
            doc.root_element(),
            &ThemeColors::default(),
            &HashMap::from([("pic".to_string(), "word/media/picture.png".to_string())]),
            &ChartMap::default(),
            &HashMap::new(),
            DepthGuard::root(),
            &mut diagnostics,
        )
        .unwrap();
        let DocRun::Shape(shape) = runs.remove(0) else {
            panic!("group wrapper")
        };
        (*shape, diagnostics)
    }

    fn children(shape: &ShapeRun) -> &[DocRun] {
        let TextBoxBlockWire::Body(BodyElement::Paragraph(p)) = &shape.text_box_content[0] else {
            panic!("group story")
        };
        &p.runs
    }

    #[test]
    fn group_maps_mixed_children_in_painter_order_with_nested_origin_rotation_and_flip() {
        let (shape, diagnostics) = parse(
            r#"<v:group style="width:200pt;height:100pt" coordsize="1000,500" coordorigin="100,50">
          <v:rect style="left:100;top:50;width:100;height:100" fillcolor="red"/>
          <v:group style="left:200;top:150;width:400;height:200;rotation:90;flip:x" coordsize="200,100" coordorigin="10,20">
            <v:shape style="left:10;top:20;width:100;height:50;rotation:30;flip:y"><v:imagedata r:id="pic"/></v:shape>
          </v:group>
          <v:oval style="left:600;top:250;width:100;height:50"/>
        </v:group>"#,
        );
        assert!(diagnostics.is_empty());
        assert!(shape.inline);
        assert_eq!((shape.width_pt, shape.height_pt), (200.0, 100.0));
        let runs = children(&shape);
        assert_eq!(runs.len(), 3);
        let DocRun::Shape(rect) = &runs[0] else {
            panic!("first rect")
        };
        assert_eq!(
            (
                rect.anchor_x_pt,
                rect.anchor_y_pt,
                rect.width_pt,
                rect.height_pt
            ),
            (0.0, 0.0, 20.0, 20.0)
        );
        let DocRun::Image(image) = &runs[1] else {
            panic!("nested picture")
        };
        // Nested centre (60,45) -> reflected/rotated centre (450,350)
        // in the outer coordinate system -> (70,60)pt; extents 40x20pt.
        assert!((image.anchor_x_pt - 50.0).abs() < 1e-9);
        assert!((image.anchor_y_pt - 50.0).abs() < 1e-9);
        assert_eq!((image.width_pt, image.height_pt), (40.0, 20.0));
        assert_eq!(image.rotation, 60.0);
        assert!(image.flip_h && image.flip_v);
        assert!(
            matches!(&runs[2], DocRun::Shape(oval) if oval.preset_geometry.as_deref() == Some("ellipse"))
        );
    }

    #[test]
    fn nested_group_is_one_signed_z_index_stacking_unit() {
        let (shape, diagnostics) = parse(
            r#"<v:group style="width:100pt;height:100pt">
          <v:rect style="left:100;width:10;height:10;z-index:2"/>
          <v:group style="width:100;height:100;z-index:-1"><v:rect style="width:10;height:10;z-index:100"/></v:group>
          <v:rect style="left:50;width:10;height:10;z-index:1"/>
        </v:group>"#,
        );
        assert!(diagnostics.is_empty());
        let positions: Vec<_> = children(&shape)
            .iter()
            .map(|run| match run {
                DocRun::Shape(shape) => shape.anchor_x_pt,
                _ => panic!("shape"),
            })
            .collect();
        assert_eq!(positions, vec![0.0, 5.0, 10.0]);
    }

    #[test]
    fn group_default_space_and_absolute_host_keep_parent_and_child_placement_separate() {
        let (shape, diagnostics) = parse(
            r#"<v:group style="position:absolute;margin-left:30pt;margin-top:40pt;width:100pt;height:50pt;rotation:15;flip:xy">
          <v:shape style="left:500;top:200;width:100;height:100"><v:imagedata r:id="pic"/></v:shape>
        </v:group>"#,
        );
        assert!(diagnostics.is_empty());
        assert!(!shape.inline);
        assert_eq!(shape.rotation, 15.0);
        assert!(shape.flip_h && shape.flip_v);
        assert!(shape.anchor_acquisition.is_some());
        let DocRun::Image(image) = &children(&shape)[0] else {
            panic!("picture")
        };
        assert_eq!(
            (
                image.anchor_x_pt,
                image.anchor_y_pt,
                image.width_pt,
                image.height_pt
            ),
            (50.0, 10.0, 10.0, 5.0)
        );
    }

    #[test]
    fn group_discloses_every_unrepresented_child_kind_and_unresolved_picture() {
        // CT_Group's complete drawable choice, including its Office extension.
        for child in [
            "arc",
            "curve",
            "polyline",
            "image",
            "diagram",
            "shadow",
            "extrusion",
            "skew",
            "clippath",
            "textbox",
            "textpath",
            "imagedata",
        ] {
            let (shape, diagnostics) = parse(&format!(
                r#"<v:group style="width:100pt;height:50pt"><v:{child}/></v:group>"#
            ));
            assert!(children(&shape).is_empty(), "{child}");
            assert!(diagnostics.is_empty(), "{child}");
            assert!(
                shape
                    .text_box_content
                    .iter()
                    .any(|block| matches!(block, TextBoxBlockWire::Unsupported { .. })),
                "{child}"
            );
        }
        let (shape, diagnostics) = parse(
            r#"<v:group style="width:100pt;height:50pt"><v:shape style="width:10;height:10"><v:imagedata r:id="missing"/></v:shape></v:group>"#,
        );
        assert!(children(&shape).is_empty());
        assert!(diagnostics.is_empty());
        assert!(shape
            .text_box_content
            .iter()
            .any(|block| matches!(block, TextBoxBlockWire::Unsupported { .. })));
    }
}
