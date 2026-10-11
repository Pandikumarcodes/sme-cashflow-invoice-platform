import { Link } from 'react-router-dom';
import styles from './FoundationPage.module.css';

export function FoundationPage() {
  return (
    <>
      <section className={styles.hero} aria-labelledby="foundation-heading">
        <div className={styles.intro}>
          <p className={styles.eyebrow}>
            <span aria-hidden="true" /> A considered start
          </p>
          <h1 id="foundation-heading">
            Clarity for your <br />
            next chapter.
          </h1>
          <p className={styles.description}>
            A dedicated workspace for your business finances.
            <br className={styles.desktopBreak} /> Thoughtfully built, from the foundation up.
          </p>
          <div className={styles.actions}>
            <Link className={styles.primary} to="/login">
              Sign in <span aria-hidden="true">→</span>
            </Link>
            <span>Your account, ready when you are.</span>
          </div>
          <p className={styles.note}>
            FRONTEND FOUNDATION <span aria-hidden="true">/</span> MILESTONE 01
          </p>
        </div>
        <aside className={styles.panel} aria-label="Foundation progress">
          <div className={styles.panelTop}>
            <span>THE WORKSPACE</span>
            <span className={styles.ready}>Foundation ready</span>
          </div>
          <div className={styles.art} aria-hidden="true">
            <div className={styles.ring} />
            <div className={styles.tileBack} />
            <div className={styles.tileFront}>
              <span className={styles.miniMark}>cf.</span>
              <span className={styles.tileLine} />
              <span className={styles.tileShort} />
              <span className={styles.tileDot} />
            </div>
            <span className={styles.cross}>+</span>
          </div>
          <h2>
            Good things start
            <br />
            with solid foundations.
          </h2>
          <p className={styles.panelText}>The first building blocks are in place.</p>
          <ul className={styles.progress}>
            {[
              'Interface & routing',
              'API transport & safe errors',
              'Query caching & cancellation',
            ].map((label) => (
              <li key={label}>
                <span>{label}</span>
                <span className={styles.check} aria-label="Complete">
                  ✓
                </span>
              </li>
            ))}
          </ul>
        </aside>
      </section>
      <section className={styles.principles} aria-label="Workspace principles">
        <article>
          <span className={styles.number}>01</span>
          <h2>One clear workspace</h2>
          <p>A focused starting point for the everyday work of running a business.</p>
        </article>
        <article>
          <span className={styles.number}>02</span>
          <h2>Precision throughout</h2>
          <p>Financial values keep their original precision, all the way from the API.</p>
        </article>
        <article>
          <span className={styles.number}>03</span>
          <h2>Built to grow with you</h2>
          <p>A simple, adaptable foundation for the capabilities that come next.</p>
        </article>
      </section>
    </>
  );
}
