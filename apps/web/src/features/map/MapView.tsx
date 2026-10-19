import SearchBar from './SearchBar.js';
import MapSheet from './MapSheet.js';

interface Props {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  onLoadMore: () => void;
  loadingMore: boolean;
  onStore: () => void;
  onCommands: () => void;
}

/**
 * Home: the ground the map will be drawn on, the floating search field, and
 * the side sheet that lists what the map shows. The map itself (terrain,
 * marks, lenses) arrives in the next milestone; until then the sheet carries
 * every memory on its own.
 */
export default function MapView({ onCommands, ...sheet }: Props) {
  return (
    <div className="mp-view">
      <div className="mp-ground" aria-hidden="true">
        <svg viewBox="0 0 400 260" className="mp-contours">
          <path d="M60 170c10-60 70-110 150-110s120 40 112 92-62 88-140 88S50 220 60 170z" />
          <path d="M104 166c6-38 46-70 100-70s82 26 76 60-42 58-94 58-88-18-82-48z" />
          <path d="M146 162c4-20 26-36 56-36s44 14 40 32-24 30-50 30-50-8-46-26z" />
        </svg>
        <p>The map is being charted. Until it is, every memory is in the list.</p>
      </div>
      <SearchBar onCommands={onCommands} />
      <MapSheet {...sheet} />
    </div>
  );
}
