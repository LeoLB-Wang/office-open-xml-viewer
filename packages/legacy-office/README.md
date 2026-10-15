# @silurus/ooxml-legacy-office

Experimental DOC, XLS and PPT model sources for `@silurus/ooxml`. Both packages
must have the same version.

```sh
npm i @silurus/ooxml @silurus/ooxml-legacy-office
```

```ts
import { DocxViewer } from '@silurus/ooxml/docx';
import { legacyDocSource } from '@silurus/ooxml-legacy-office/doc';

const canvas = document.getElementById('viewer') as HTMLCanvasElement;
const viewer = new DocxViewer(canvas, { modelSources: [legacyDocSource()] });
```

Use `/xls` (`legacyXlsSource`) and `/ppt` (`legacyPptSource`) with the
corresponding viewers or Node sessions. Creating a source loads no reader.
The package ships three external WASM assets and self-contained source modules.
See the [usage and support guide](https://github.com/yukiyokotani/office-open-xml-viewer/blob/main/docs/legacy-office-conversion.md).
