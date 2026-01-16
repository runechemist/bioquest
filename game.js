/* BioQuest MVP - game.js (FULL FILE)
   Works on GitHub Pages.
   Fixes Phaser error: uses this.add.rectangle + this.physics.add.existing() (no this.physics.add.rectangle)

   Files expected:
   - /shared/storage.js  (provides window.BQ)
   - /data/questions_world1-1.json

   Student flow:
   - Enter Class Code + Student ID + Mode
   - Start World 1-1
   - Gameplay: A/D or Arrows to move, Up to jump
   - Hit ? blocks from below to answer questions
   - Stomp enemies to defeat
   - Touch flag to end
   - Writes results to localStorage (via BQ.writeResult)
*/

(() => {
  const UI = document.getElementById("ui");

  function uiTemplate() {
    UI.innerHTML = `
      <div class="panel">
        <div class="row">
          <div>
            <label>Class Code</label>
            <input id="classCode" placeholder="e.g., AB3K9Q" maxlength="12" />
            <div class="small">Teacher creates this code in the dashboard.</div>
          </div>
          <div>
            <label>Student ID (nickname or last-4)</label>
            <input id="studentId" placeholder="e.g., MARLIN123 or 4821" maxlength="24" />
            <div class="small">Use a non-identifying nickname if desired.</div>
          </div>
          <div>
            <label>Mode</label>
            <select id="mode">
              <option value="assessment">Assessment</option>
              <option value="practice">Practice</option>
            </select>
            <div class="small">Assessment uses attempts/lives; Practice can be infinite.</div>
          </div>
        </div>
        <div class="row">
          <button id="startBtn">Start World 1-1</button>
        </div>
        <div class="small">
          Controls: A/D or ◀▶ to move. ▲ to jump. Stomp enemies from above.
        </div>
      </div>
    `;
  }

  uiTemplate();

  const startBtn = document.getElementById("startBtn");
  startBtn.addEventListener("click", onStart);

  async function onStart() {
    const classCode = (document.getElementById("classCode").value || "").trim().toUpperCase();
    const studentId = (document.getElementById("studentId").value || "").trim();
    const mode = document.getElementById("mode").value;

    if (!classCode || !studentId) {
      alert("Enter Class Code and Student ID.");
      return;
    }
    if (!window.BQ) {
      alert("Storage library not loaded. Ensure shared/storage.js is included before game.js.");
      return;
    }

    // Load class settings (local-first)
    const settings = BQ.getClassSettings(classCode);

    // Load question bank with clear error reporting
    let questionBank;
    try {
      const res = await fetch("./data/questions_world1-1.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`questions_world1-1.json HTTP ${res.status}`);
      questionBank = await res.json();
      if (!questionBank?.questions?.length) throw new Error("Question bank is empty or malformed.");
    } catch (e) {
      console.error(e);
      alert("Game failed to load question data.\n\n" + e.message);
      return;
    }

    const session = {
      classCode,
      studentId,
      mode,
      settings,
      startedAtISO: new Date().toISOString()
    };

    // Hide UI panel and show badges
    UI.innerHTML = `
      <div class="panel">
        <span class="badge">Class ${escapeHtml(classCode)}</span>
        <span class="badge">Student ${escapeHtml(studentId)}</span>
        <span class="badge">${escapeHtml(mode)}</span>
      </div>
    `;

    startGame(session, questionBank);
  }

  function startGame(session, questionBank) {
    const config = {
      type: Phaser.AUTO,
      parent: "game",
      width: 960,
      height: 540,
      physics: {
        default: "arcade",
        arcade: { debug: false, gravity: { y: 0 } }
      },
      scene: [makeScene(session, questionBank)]
    };

    if (window.__bioquestGame) window.__bioquestGame.destroy(true);
    window.__bioquestGame = new Phaser.Game(config);
  }

  function makeScene(session, questionBank) {
    return class BioQuestScene extends Phaser.Scene {
      constructor() {
        super("BioQuestScene");
        this.score = 0;
        this.correct = 0;
        this.answered = 0;
        this.lives = 3;
        this.attempt = 1;
        this.levelStartMs = 0;
        this.qIndex = 0;
      }

      // ----- Helpers: rectangles + Arcade Physics bodies -----
      makeStaticRect(x, y, w, h, color) {
        const r = this.add.rectangle(x, y, w, h, color);
        this.physics.add.existing(r, true); // static body
        return r;
      }

      makeDynamicRect(x, y, w, h, color) {
        const r = this.add.rectangle(x, y, w, h, color);
        this.physics.add.existing(r, false); // dynamic body
        return r;
      }

      create() {
        const H = 540;
        const levelWidth = 3000;

        // Settings
        const s = session.settings || {};
        this.infiniteLives = (session.mode === "practice") ? true : !!s.infiniteLives;
        this.masteryAccuracy = Number(s.masteryAccuracy ?? 70);
        this.attemptsAllowed = Number(s.attemptsAllowed ?? 3);

        this.cameras.main.setBackgroundColor("#111");
        this.physics.world.setBounds(0, 0, levelWidth, H);

        // HUD
        this.hud = this.add.text(12, 10, "", {
          fontFamily: "monospace",
          fontSize: "16px",
          color: "#fff"
        }).setScrollFactor(0);

        // Groups
        this.platforms = this.physics.add.staticGroup();
        this.coins = this.physics.add.staticGroup();
        this.qblocks = this.physics.add.staticGroup();
        this.flag = this.physics.add.staticGroup();
        this.enemies = this.physics.add.group(); // dynamic

        // Ground
        for (let x = 0; x < levelWidth; x += 64) {
          const g = this.makeStaticRect(x + 32, H - 20, 64, 40, 0x2a2a2a);
          this.platforms.add(g);
        }

        // Floating platforms
        this.addPlatform(380, 380, 180, 20);
        this.addPlatform(780, 320, 220, 20);
        this.addPlatform(1260, 360, 220, 20);
        this.addPlatform(1700, 320, 260, 20);
        this.addPlatform(2200, 360, 220, 20);

        // Player
        this.player = this.makeDynamicRect(80, H - 80, 26, 34, 0x66ccff);
        this.player.body.setCollideWorldBounds(true);
        this.player.body.setGravityY(900);

        // Coins
        this.spawnCoin(220, H - 90);
        this.spawnCoin(420, 340);
        this.spawnCoin(820, 280);
        this.spawnCoin(1760, 280);

        // Enemies
        this.spawnEnemy(520, H - 80);
        this.spawnEnemy(980, H - 80);
        this.spawnEnemy(1500, H - 80);

        // Question blocks
        this.spawnQBlock(320, 300, "qb1");
        this.spawnQBlock(1100, 300, "qb2");
        this.spawnQBlock(2050, 300, "qb3");

        // Flagpole
        const flagRect = this.makeStaticRect(levelWidth - 150, H - 120, 18, 200, 0x00ff66);
        this.flag.add(flagRect);

        // Colliders
        this.physics.add.collider(this.player, this.platforms);
        this.physics.add.collider(this.enemies, this.platforms);

        // Overlaps
        this.physics.add.overlap(this.player, this.coins, this.onCoin, null, this);
        this.physics.add.overlap(this.player, this.enemies, this.onEnemy, null, this);
        this.physics.add.overlap(this.player, this.qblocks, this.onQBlock, null, this);
        this.physics.add.overlap(this.player, this.flag, this.onWin, null, this);

        // Camera follow
        this.cameras.main.startFollow(this.player, true, 0.08, 0.08);
        this.cameras.main.setBounds(0, 0, levelWidth, H);

        // Controls
        this.cursors = this.input.keyboard.createCursorKeys();
        this.keyA = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A);
        this.keyD = this.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D);

        this.levelStartMs = Date.now();
        this.updateHUD();
      }

      addPlatform(x, y, w, h) {
        const p = this.makeStaticRect(x, y, w, h, 0x444444);
        this.platforms.add(p);
      }

      spawnCoin(x, y) {
        const c = this.makeStaticRect(x, y, 14, 14, 0xffdd55);
        this.coins.add(c);
      }

      spawnEnemy(x, y) {
        const e = this.makeDynamicRect(x, y, 26, 26, 0xff6666);
        this.enemies.add(e);
        e.body.setGravityY(900);
        e.body.setCollideWorldBounds(true);
        e.body.setVelocityX(-80);
      }

      spawnQBlock(x, y, id) {
        const qb = this.makeStaticRect(x, y, 26, 26, 0xddddff);
        qb.setStrokeStyle(2, 0xffffff);
        qb.qbId = id;
        qb.used = false;
        this.qblocks.add(qb);
      }

      update() {
        const left = this.cursors.left.isDown || this.keyA.isDown;
        const right = this.cursors.right.isDown || this.keyD.isDown;

        if (left) this.player.body.setVelocityX(-180);
        else if (right) this.player.body.setVelocityX(180);
        else this.player.body.setVelocityX(0);

        const onGround = this.player.body.blocked.down;
        if (this.cursors.up.isDown && onGround) this.player.body.setVelocityY(-420);

        // Enemy patrol reverse on walls
        this.enemies.children.iterate(e => {
          if (!e?.body) return;
          if (e.body.blocked.left) e.body.setVelocityX(80);
          if (e.body.blocked.right) e.body.setVelocityX(-80);
        });

        this.updateHUD();
      }

      onCoin(player, coin) {
        coin.destroy();
        this.score += 10;
      }

      onEnemy(player, enemy) {
        const playerFalling = player.body.velocity.y > 50;
        const playerAbove = player.y + 10 < enemy.y;

        // Stomp
        if (playerFalling && playerAbove) {
          enemy.destroy();
          player.body.setVelocityY(-260);
          this.score += 25;
          return;
        }

        // Take damage
        if (!this.infiniteLives) this.lives -= 1;

        player.body.setVelocityX(player.x < enemy.x ? -220 : 220);
        player.body.setVelocityY(-260);

        if (!this.infiniteLives && this.lives <= 0) {
          this.endAttempt(false, "out_of_lives");
        }
      }

      onQBlock(player, qb) {
        if (qb.used) return;

        // Hit from below like Mario
        const hitFromBelow = player.body.velocity.y < -50 && player.y > qb.y;
        if (!hitFromBelow) return;

        qb.used = true;
        qb.fillColor = 0x777799;

        const q = questionBank.questions[this.qIndex % questionBank.questions.length];
        this.qIndex++;

        const choiceText = q.choices.map((c, i) => `${i + 1}) ${c}`).join("\n");
        const raw = prompt(`${q.prompt}\n\n${choiceText}\n\nType 1-4:`);

        this.answered += 1;
        const idx = parseInt(raw, 10) - 1;

        if (idx === q.answerIndex) {
          this.correct += 1;
          this.score += 50;
          this.spawnCoin(qb.x, qb.y - 30);
        } else {
          this.spawnEnemy(qb.x + 40, qb.y - 20);
        }
      }

      onWin() {
        this.endAttempt(true, "completed");
      }

      endAttempt(completed, reason) {
        const ms = Date.now() - this.levelStartMs;
        const accuracy = this.answered === 0 ? 0 : Math.round((this.correct / this.answered) * 100);

        const result = {
          levelId: questionBank.levelId || "world1-1",
          completed,
          reason,
          score: this.score,
          answered: this.answered,
          correct: this.correct,
          accuracy,
          livesRemaining: this.infiniteLives ? null : this.lives,
          attempt: this.attempt,
          durationMs: ms,
          atISO: new Date().toISOString(),
          masteryMet: accuracy >= this.masteryAccuracy
        };

        BQ.writeResult(session.classCode, session.studentId, result);

        alert(
          `Level End\n\n` +
          `Completed: ${completed}\n` +
          `Accuracy: ${accuracy}% (Mastery: ${this.masteryAccuracy}%)\n` +
          `Score: ${this.score}\n` +
          `Answered: ${this.correct}/${this.answered}\n` +
          `Attempt: ${this.attempt}/${this.attemptsAllowed}\n`
        );

        if (session.mode === "assessment" && !result.masteryMet) {
          this.attempt += 1;
          if (this.attempt > this.attemptsAllowed) {
            this.scene.restart();
            return;
          }
        }

        this.scene.restart();
      }

      updateHUD() {
        const accuracy = this.answered === 0 ? 0 : Math.round((this.correct / this.answered) * 100);
        const lifeText = this.infiniteLives ? "∞" : String(this.lives);
        this.hud.setText(`Score ${this.score}   Lives ${lifeText}   Acc ${accuracy}%   Q ${this.correct}/${this.answered}`);
      }
    };
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    }[c]));
  }
})();
