import React from 'react';

export const Overview: React.FC = () => (
  <>
    <section className="hero">
      <h1>Control the studio. Keep the creator flow fast.</h1>
      <p>
        This portal is the command layer for teams, projects, usage, and billing. The actual
        storyboarding editor stays isolated behind the embed so partners can integrate without
        receiving source code.
      </p>
    </section>

    <section className="grid">
      <div className="card">
        <h3>Team Management</h3>
        <p>Invite collaborators, assign roles, and keep projects separated by team space.</p>
      </div>
      <div className="card">
        <h3>Project Library</h3>
        <p>Search, filter, and track project status across client workspaces.</p>
      </div>
      <div className="card">
        <h3>Billing & Seats</h3>
        <p>Seat-based access with Stripe billing and upgrade paths per team.</p>
      </div>
      <div className="card">
        <h3>Usage Analytics</h3>
        <p>Monitor renders, generations, and exports by team and project.</p>
      </div>
    </section>
  </>
);
