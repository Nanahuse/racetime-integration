import {diffValues} from "../model/diff";

export function DiffTable({before, after}: {before: unknown; after: unknown}) {
	const entries = diffValues(before, after);
	if (entries.length === 0)
		return <p className='muted'>保存済みの最新内容と同じです。</p>;
	return (
		<table className='participants'>
			<thead>
				<tr>
					<th>項目</th>
					<th>最新（保存済み）</th>
					<th>編集値</th>
				</tr>
			</thead>
			<tbody>
				{entries.map((entry) => (
					<tr key={entry.path}>
						<td>{entry.path}</td>
						<td>{entry.before}</td>
						<td>{entry.after}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}
