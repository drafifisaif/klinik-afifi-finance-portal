import { Activity, CalendarDays, UserRoundPlus, UsersRound } from "lucide-react";

export function PatientSummaryCards({
  completedPeriods,
  newPatients,
  periodNo,
  periodLabel,
  uniqueLabel,
  uniqueTitle,
  uniquePatients,
  visits
}: {
  completedPeriods: number;
  newPatients: number;
  periodNo?: number;
  periodLabel?: string;
  uniqueLabel?: string;
  uniqueTitle?: string;
  uniquePatients: number;
  visits: number;
}) {
  return (
    <div className="patient-summary-grid">
      <article className="patient-summary-card">
        <span className="patient-summary-icon tone-blue"><Activity size={20} /></span>
        <div><p>Jumlah lawatan</p><strong>{visits.toLocaleString()}</strong><small>{periodLabel ?? (periodNo ? `Tempoh ${periodNo}` : "Belum ada import")}</small></div>
      </article>
      <article className="patient-summary-card">
        <span className="patient-summary-icon tone-teal"><UsersRound size={20} /></span>
        <div><p>{uniqueTitle ?? "Pesakit unik"}</p><strong>{uniquePatients.toLocaleString()}</strong><small>{uniqueLabel ?? "PID unik mengikut cawangan dalam tempoh"}</small></div>
      </article>
      <article className="patient-summary-card">
        <span className="patient-summary-icon tone-amber"><UserRoundPlus size={20} /></span>
        <div><p>PID pertama kali direkod</p><strong>{newPatients.toLocaleString()}</strong><small>Dalam sejarah import portal</small></div>
      </article>
      <article className="patient-summary-card">
        <span className="patient-summary-icon tone-rose"><CalendarDays size={20} /></span>
        <div><p>Tempoh lengkap</p><strong>{completedPeriods.toLocaleString()}</strong><small>Tempoh/cawangan telah diimport</small></div>
      </article>
    </div>
  );
}
