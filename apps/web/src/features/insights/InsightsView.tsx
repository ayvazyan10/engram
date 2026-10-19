import NumbersTab from './NumbersTab.js';
import ReflectionsTab from './ReflectionsTab.js';
import './insights.css';

/**
 * Insights, the lazily loaded chunk (recharts lives only here): Numbers or
 * Reflections, picked by the shell's tabs from the route.
 */
export default function InsightsView({ tab }: { tab: 'numbers' | 'reflections' }) {
  return <div className="in-page"><h1 className="at-sr">Insights</h1>{tab === 'reflections' ? <ReflectionsTab /> : <NumbersTab />}</div>;
}
