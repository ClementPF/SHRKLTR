package calc.entity;

import javax.persistence.*;

/**
 * Created by clementperez on 9/13/16.
 */

@Entity

@NamedQueries({
        @NamedQuery(name = "Outcome.findByUserId", query = "SELECT o FROM Outcome o WHERE o.user.userId = ?1"),
        @NamedQuery(name = "Outcome.findByGameId", query = "SELECT o FROM Outcome o WHERE o.game.gameId = ?1")
})
public class Outcome {

    @Id
    @GeneratedValue(strategy= GenerationType.AUTO)
    private Long outcomeId;
    @Column(nullable = false)
    private double scoreValue;
    @Column(nullable = false)
    private Result result;
    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "gameId")
    private Game game;
    @ManyToOne(fetch = FetchType.EAGER)
    @JoinColumn(name = "userId")
    private User user;

    protected Outcome() {}

    public Outcome(double scoreValue, Result results, Game game, User user) {
        this.scoreValue = scoreValue;
        this.result = results;
        this.game = game;
        this.user = user;
    }

    public Long getOutcomeId() {
        return outcomeId;
    }

    public void setOutcomeId(Long outcomeId) {
        this.outcomeId = outcomeId;
    }

    public double getScoreValue() {
        return scoreValue;
    }

    public void setScoreValue(double scoreValue) {
        this.scoreValue = scoreValue;
    }

    public Result getResults() {
        return result;
    }

    public void setResults(Result results) {
        this.result = results;
    }

    public Game getGame() {
        return game;
    }

    public void setGame(Game game) {
        this.game = game;
    }

    public User getUser() {
        return user;
    }

    public void setUser(User user) {
        this.user = user;
    }

    public enum Result {
        WIN(1),
        TIE(2),
        LOSS(3);

         Result(int i) {
        }
    };

    public boolean isWin(){
        return this.result == Result.WIN;
    }
    public boolean isLoss(){
        return this.result == Result.LOSS;
    }
    public boolean isTie(){
        return this.result == Result.TIE;
    }
}
