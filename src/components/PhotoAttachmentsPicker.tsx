import { useEffect, useMemo } from 'react';
import { ImagePlus, X } from 'lucide-react';

interface Props {
  files: File[];
  onChange: (files: File[]) => void;
  label: string;
  hint: string;
  maxFiles?: number;
}

export function PhotoAttachmentsPicker({ files, onChange, label, hint, maxFiles = 8 }: Props) {
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach(({ url }) => URL.revokeObjectURL(url)), [previews]);

  function addFiles(selection: FileList | null) {
    if (!selection) return;
    const incoming = Array.from(selection).filter((candidate) => candidate.type.startsWith('image/'));
    const combined = [...files];
    for (const file of incoming) {
      if (combined.length >= maxFiles) break;
      if (!combined.some((existing) => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)) combined.push(file);
    }
    onChange(combined);
  }

  return <div className="photo-attachments">
    <label className="photo-pick">
      <span className="photo-pick-icon"><ImagePlus size={19} /></span>
      <span><strong>{label}</strong><small>{hint} · up to {maxFiles}</small></span>
      <input type="file" accept="image/*" capture="environment" multiple onChange={(event) => { addFiles(event.target.files); event.currentTarget.value = ''; }} />
    </label>
    {files.length > 0 && <div className="photo-attachment-list" aria-label="Selected photos">
      {previews.map(({ file, url }, index) => <div className="photo-attachment" key={`${file.name}-${file.size}-${file.lastModified}`}>
        <img src={url} alt={`Preview ${file.name}`} />
        <span title={file.name}>{file.name}</span>
        <button type="button" className="icon-button small" aria-label={`Remove ${file.name}`} onClick={() => onChange(files.filter((_, itemIndex) => itemIndex !== index))}><X size={14} /></button>
      </div>)}
    </div>}
  </div>;
}
