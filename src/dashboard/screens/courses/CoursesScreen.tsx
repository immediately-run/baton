// CoursesScreen.tsx — `/repositories/{r}/courses` (B-212 item 3): one card per course of the
// repository — `repo.courses` names them, `course.show?summary=1` (no tickets, no runs) fills
// each: id and version, the runners declaring it and alive, the small graph with resting counts
// and each leg's state, the legs' table with the window's figures, an end station's arrivals,
// and a refused newer file as a notice. Read-only: a course changes by a commit (§5.7).
import { ReadGate } from '../../app/Refusal';
import { Link, pathOrNull } from '../../app/router';
import { useRead, useReads, type Read } from '../../lib/reads';
import { Text } from '../../lib/Text';
import { Band, Card, CliLine, Empty, ErrorNote, Loading, PageHeader } from '../../lib/ui';
import type { ScreenProps } from '../contract';
import { windowWords } from '../runners/types';
import { CourseGraph } from './CourseGraph';
import { LegTable } from './LegTable';
import type { CourseAnswer, CoursesAnswer } from './types';
import './courses.css';

/** The list's window: the mockup's "over 7 days". */
export const LIST_WINDOW = '7d';

export function RefusedNotice({ course }: { course: CourseAnswer }) {
  if (!course.refused) return null;
  return (
    <Band tone="warn">
      <p>
        ▲ A newer file, version <Text mono value={course.refused.version} />, was refused: <Text value={course.refused.reason} />.{' '}
        {course.course.version != null ? <>Version <Text mono value={course.course.version} /> stays in force.</> : <>No version is in force.</>}
      </p>
    </Band>
  );
}

function CourseCard({ repository, id, read }: { repository: string; id: string; read: Read<CourseAnswer> }) {
  const to = pathOrNull('repository/courses/{course}', { repository, course: id });
  const title = to ? <Link to={to}><Text mono value={id} /></Link> : <Text mono value={id} />;
  const c = read.data;
  if (!c) {
    return <Card className="course-card" title={title}>{read.error ? <ErrorNote error={read.error} /> : <Loading />}</Card>;
  }
  const ends = (c.stations ?? []).filter((s) => s.end);
  return (
    <Card className="course-card" title={title} aside={c.course.version != null ? <span className="mono">v<Text value={c.course.version} /></span> : <span className="mut">no version in force</span>}>
      <p className="course-line">
        runners <strong>{c.runners.declaring}</strong> declaring, <strong>{c.runners.alive}</strong> alive
        {' '}· {c.counts.tickets} tickets on it
        {' '}· window {windowWords(c.window.until - c.window.since)}
        {c.intake === 'closed' ? <span className="tone-warn"> · ▲ intake closed</span> : null}
        {ends.map((s) => <span key={s.station}> · <Text mono value={s.station} /> {s.arrived_today} in 24 h</span>)}
      </p>
      <RefusedNotice course={c} />
      {c.course.file != null ? (
        <>
          <CourseGraph file={c.course.file} stations={c.stations} legs={c.legs} size="small" label={`Course ${id}: its stations and legs`} />
          <LegTable file={c.course.file} legs={c.legs} />
        </>
      ) : <p className="empty">No file of this course was ever accepted.</p>}
    </Card>
  );
}

export function CoursesScreen({ params }: ScreenProps) {
  const repository = params.repository;
  const base = `/v1/repositories/${encodeURIComponent(repository)}/courses`;
  const list = useRead<CoursesAnswer>(base);
  const ids = (list.data?.courses ?? []).map((c) => c.id).filter((id): id is string => typeof id === 'string');
  const summaries = useReads(ids.map((id) => `${base}/${encodeURIComponent(id)}?summary=1&since=${LIST_WINDOW}`)) as Read<CourseAnswer>[];
  return (
    <>
      <PageHeader title="Courses" sub="Each course as its stations and legs: where tickets rest, what each leg’s queue holds, and how the legs ran." />
      <ReadGate read={list} entity="repository" id={repository}>
        {() => (ids.length === 0
          ? <Empty>This repository has no course. Its sync posts them from <CliLine>.baton/</CliLine>.</Empty>
          : <div className="course-cards">{ids.map((id, i) => <CourseCard key={id} repository={repository} id={id} read={summaries[i]} />)}</div>)}
      </ReadGate>
      <p className="mut course-foot">Read-only: a course changes by a commit to its file.</p>
    </>
  );
}
