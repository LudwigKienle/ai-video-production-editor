import React from 'react';
import { fetchUsage, Usage } from '../services/dataService';

export const Analytics: React.FC = () => {
  const [usage, setUsage] = React.useState<Usage[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetchUsage().then((data) => {
      setUsage(data);
      setLoading(false);
    });
  }, []);

  return (
    <div className="panel">
      <h2>Analytics</h2>
      {loading ? (
        <p style={{ color: 'var(--muted)' }}>Loading usage...</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Team ID</th>
              <th>Type</th>
              <th>Quantity</th>
            </tr>
          </thead>
          <tbody>
            {usage.map(item => (
              <tr key={item.id}>
                <td>{item.team_id}</td>
                <td>{item.type}</td>
                <td>{item.quantity}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};
