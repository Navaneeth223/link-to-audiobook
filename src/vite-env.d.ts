declare module '*.css';
declare module '*?url' { const url: string; export default url; }
interface ImportMetaEnv { readonly VITE_SUPPORT_URL?: string; }
interface ImportMeta { readonly env: ImportMetaEnv; }
