// Empty stub: jspdf may try to dynamic-import html2canvas even when
// our code only uses the text/vector API. Aliasing to this stub keeps
// the bundle ~200KB smaller. The function throws if called — which
// it never will be, because our pdf-report only uses autoTable.
export default function html2canvas(): Promise<never> {
  return Promise.reject(new Error('html2canvas is not bundled in this build.'))
}
