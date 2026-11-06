package calc.service;

import calc.DTO.*;
import calc.entity.*;
import calc.exception.APIException;
import calc.repository.*;
import org.hibernate.annotations.NotFound;
import org.hibernate.annotations.NotFoundAction;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestExecutionListeners;
import org.springframework.test.context.junit4.SpringRunner;
import org.springframework.test.context.support.DependencyInjectionTestExecutionListener;
import org.springframework.test.context.support.DirtiesContextTestExecutionListener;

import javax.persistence.JoinColumn;
import javax.persistence.OneToOne;
import java.text.ParseException;
import java.util.*;
import java.util.stream.Collectors;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.in;


@SpringBootTest
//@PropertySource(value = {"classpath:application.properties", "${api.config.location}"}, ignoreResourceNotFound = true)
@TestExecutionListeners(inheritListeners = false, listeners = {
        DependencyInjectionTestExecutionListener.class,
        DirtiesContextTestExecutionListener.class
})
@RunWith(SpringRunner.class)
public class StatsServiceTest {


    @Autowired
    private GameService gameService;
    @Autowired
    private StatsService statsService;
    @Autowired
    private StatsRepository statsRepository;
    @Autowired
    private RivalryStatsRepository rivalryStatsRepository;
    @Autowired
    private SportRepository sportRepository;
    @Autowired
    private UserService userService;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private TournamentService tournamentService;
    @Autowired
    private TournamentRepository tournamentRepository;

    @Autowired
    private GameRepository gameRepository;

    List<GameDTO> allGames ;
    UserServiceTest userServiceTest;
    SportServiceTest sportServiceTest;
    RivalryServiceTest rivalryServiceTest;
    TournamentServiceTest tournamentServiceTest;
    GameServiceTest gameServiceTest;

    User u1;
    User u2;
    User u3;
    Stats s1;
    Stats s2;
    Stats s3;
    Sport sport;
    Tournament tournament;

    @Before
    public void setUp() {
        userServiceTest = new UserServiceTest();
        tournamentServiceTest = new TournamentServiceTest();
        gameServiceTest = new GameServiceTest();
        rivalryServiceTest = new RivalryServiceTest();
        sportServiceTest = new SportServiceTest();

        u1 = userRepository.save(userServiceTest.makeRandomUser());
        u2 = userRepository.save(userServiceTest.makeRandomUser());
        u3 = userRepository.save(userServiceTest.makeRandomUser());
        
        sport = sportRepository.save(sportServiceTest.makeRandomSport());
        tournament = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport, u1));

        s1 = statsRepository.save(makeRandomStats(u1,tournament));
        s2 = statsRepository.save(makeRandomStats(u2,tournament));
        s3 = statsRepository.save(makeRandomStats(u3,tournament));
    }

    @Test
    public void findByTournament(){
        List<StatsDTO> stats = statsService.findByTournament(tournamentService.convertToDto(tournament));

        assertThat(stats.size()).isEqualTo(3);
    }

    @Test
    public void findByUser(){
        List<StatsDTO> stats = statsService.findByUser(userService.convertToDto(u1));
        assertThat(stats.size()).isEqualTo(1);
    }

    @Test
    public void findByUserName(){
        List<StatsDTO> stats = statsService.findByUserName(u1.getUserName());
        assertThat(stats.size()).isEqualTo(1);
    }

    @Test
    public void save(){
        Tournament newTournament = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport,u1));
        Stats newStats = statsRepository.save(makeRandomStats(u1,newTournament));

        Stats fetchedStats = statsRepository.findOne(newStats.getStatsId());
        assertThat(fetchedStats.getStatsId()).isEqualTo(newStats.getStatsId());
    }

    @Test
    public void findByUserAndTournament(){
        StatsDTO stats = statsService.findByUserAndTournament(u1.getUserId(), tournament.getTournamentId());
        assertThat(s1.getStatsId()).isEqualTo(stats.getStatsId());
    }

    @Test
    public void findByUserNameAndTournament(){
        StatsDTO stats = statsService.findByUserNameAndTournament(u1.getUserName(), tournament.getName());
        assertThat(statsService.convertToDto(s1).getStatsId()).isEqualTo(stats.getStatsId());
    }

    @Test
    public void whenNoStats_shouldCreateOne(){
        Tournament newTournament = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(sport,u1));
        StatsDTO stats = statsService.findByUserAndTournament(u1.getUserId(),newTournament.getTournamentId());
        assertThat(stats).isNull();

        StatsDTO statsDTO = statsService.findByUserAndTournamentCreateIfNone(userService.convertToDto(u1),tournamentService.convertToDto(newTournament));

        stats = statsService.findByUserAndTournament(u1.getUserId(),newTournament.getTournamentId());
        assertThat(stats).isNotNull();
    }

    @Test
    public void recalculateAfterOutcome_Win(){

        Game g = gameServiceTest.makeRandomGame(u1,u2,tournament);
        int winnerIndex = g.getOutcomes().get(0).getResults() == Outcome.Result.WIN ? 0 : 1;

        Double oldScore = s1.getScore();
        int gameCount = s1.getGameCount();
        int winCount = s1.getWinCount();

        s1 = statsService.recalculateAfterOutcome(g.getOutcomes().get(winnerIndex));

        assertThat(oldScore + g.getOutcomes().get(winnerIndex).getScoreValue()).isEqualTo(s1.getScore());
        assertThat(gameCount + 1).isEqualTo(s1.getGameCount());
        assertThat(winCount + 1).isEqualTo(s1.getWinCount());
    }

    @Test
    public void recalculateAfterOutcome_Loss(){

        Game g = gameServiceTest.makeRandomGame(u2,u1,tournament);
        int looserIndex = g.getOutcomes().get(0).getResults() == Outcome.Result.LOSS ? 0 : 1;

        Double oldScore = s1.getScore();
        int gameCount = s1.getGameCount();
        int loseCount = s1.getLoseCount();

        s1 = statsService.recalculateAfterOutcome(g.getOutcomes().get(looserIndex));

        assertThat(oldScore + g.getOutcomes().get(looserIndex).getScoreValue()).isEqualTo(s1.getScore());
        assertThat(gameCount + 1).isEqualTo(s1.getGameCount());
        assertThat(loseCount + 1).isEqualTo(s1.getLoseCount());
    }

    @Test
    public void convertToDto() {
        StatsDTO convertedStats = statsService.convertToDto(s1);

        assertThat(convertedStats.getStatsId()).isEqualTo(s1.getStatsId());
        assertThat(convertedStats.getWinCount()).isEqualTo(s1.getWinCount());
        assertThat(convertedStats.getGameCount()).isEqualTo(s1.getGameCount());
        assertThat(convertedStats.getLoseCount()).isEqualTo(s1.getLoseCount());
        assertThat(convertedStats.getLonguestWinStreak()).isEqualTo(s1.getLonguestWinStreak());
        assertThat(convertedStats.getLonguestLoseStreak()).isEqualTo(s1.getLonguestLoseStreak());
        assertThat(convertedStats.getLonguestTieStreak()).isEqualTo(s1.getLonguestTieStreak());
        assertThat(convertedStats.getLoseStreak()).isEqualTo(s1.getLoseStreak());
        assertThat(convertedStats.getWinStreak()).isEqualTo(s1.getWinStreak());
        assertThat(convertedStats.getTieStreak()).isEqualTo(s1.getTieStreak());
        assertThat(convertedStats.getUser().getUsername()).isEqualTo(s1.getUser().getUserName());
    }

    @Test
    public void convertToEntity() {
        UserDTO userDTO = userService.convertToDto(u1);

        TournamentDTO tournamentDTO = tournamentService.convertToDto(tournament);

        StatsDTO statsDTO = statsService.save(makeRandomStatsDTO(userDTO,tournamentDTO));

        try {
            Stats convertedStats = statsService.convertToEntity(statsDTO);
            assertThat(convertedStats.getStatsId()).isEqualTo(statsDTO.getStatsId());
            assertThat(convertedStats.getWinCount()).isEqualTo(statsDTO.getWinCount());
            assertThat(convertedStats.getGameCount()).isEqualTo(statsDTO.getGameCount());
            assertThat(convertedStats.getLoseCount()).isEqualTo(statsDTO.getLoseCount());
            assertThat(convertedStats.getLonguestWinStreak()).isEqualTo(statsDTO.getLonguestWinStreak());
            assertThat(convertedStats.getLonguestLoseStreak()).isEqualTo(statsDTO.getLonguestLoseStreak());
            assertThat(convertedStats.getLonguestTieStreak()).isEqualTo(statsDTO.getLonguestTieStreak());
            assertThat(convertedStats.getLoseStreak()).isEqualTo(statsDTO.getLoseStreak());
            assertThat(convertedStats.getWinStreak()).isEqualTo(statsDTO.getWinStreak());
            assertThat(convertedStats.getTieStreak()).isEqualTo(statsDTO.getTieStreak());
            assertThat(convertedStats.getUser().getUserName()).isEqualTo(statsDTO.getUser().getUsername());
        } catch (ParseException e) {
            e.printStackTrace();
        }
    }

    //@Test
    public void convertToDtoAndBack() {
        UserDTO userDTO = userService.convertToDto(u1);
        UserDTO userDTO1 = userService.convertToDto(u2);
        TournamentDTO tournamentDTO = tournamentService.convertToDto(tournament);

        StatsDTO statsDTO = makeRandomStatsDTO(userDTO,tournamentDTO);

        try {
            StatsDTO convertedStats = statsService.convertToDto(statsService.convertToEntity(statsDTO));
            assertThat(convertedStats).isEqualToComparingFieldByField(statsDTO);
        } catch (ParseException e) {
            e.printStackTrace();
        }
    }

    //@Test
    public void convertToEntityAndBack() {
        try {
            Stats convertedStats = statsService.convertToEntity(statsService.convertToDto(s1));
            User u = convertedStats.getUser();
            Tournament t = convertedStats.getTournament();
            convertedStats.setTournament(null);
            convertedStats.setUser(null);
            assertThat(convertedStats).isEqualToComparingFieldByFieldRecursively(s1);
        } catch (ParseException e) {
            e.printStackTrace();
        }
    }

    @Test
    public void whenNoBestRivalry_WinShouldCreateOne(){

        Stats stats = makeRandomStats(u1,tournament);
        stats.setBestRivalry(null);
        //statsRepository.save(stats);

        RivalryStats rivalryStats = rivalryServiceTest.makeRandomRivalryStats(u1,u2,stats);
        rivalryStats.setScore(Math.abs(rivalryStats.getScore()));

        statsService.recalculateBestRivalry(rivalryStats);

        assertThat(stats.getBestRivalry()).isEqualTo(rivalryStats);
    }

    @Test
    public void whenNoBestRivalry_LossShouldNotCreateOne(){

        Stats stats = makeRandomStats(u1,tournament);
        stats.setBestRivalry(null);
        //statsRepository.save(stats);

        RivalryStats rivalryStats = rivalryServiceTest.makeRandomRivalryStats(u1,u2,stats);
        rivalryStats.setScore(-Math.abs(rivalryStats.getScore()));

        statsService.recalculateBestRivalry(rivalryStats);

        assertThat(stats.getBestRivalry()).isEqualTo(null);
    }

    @Test
    public void whenBestRivalry_aBetterRivalryShouldReplace(){

        Stats stats = makeRandomStats(u1,tournament);
        stats.setBestRivalry(null);

        RivalryStats rivalryStats = rivalryServiceTest.makeRandomRivalryStats(u1,u2,stats);
        rivalryStats.setScore(Math.abs(rivalryStats.getScore()));
        stats.setBestRivalry(rivalryStats);

        RivalryStats betterRivalryStats = rivalryServiceTest.makeRandomRivalryStats(u1,u3,stats);
        betterRivalryStats.setScore(Math.abs(rivalryStats.getScore()) + 1);

        statsService.recalculateBestRivalry(betterRivalryStats);

        assertThat(stats.getBestRivalry()).isEqualTo(betterRivalryStats);
    }

    @Test
    public void whenWorstRivalry_aWorseRivalryShouldReplace(){

        Stats stats = makeRandomStats(u1,tournament);
        stats.setWorstRivalry(null);

        RivalryStats rivalryStats = rivalryServiceTest.makeRandomRivalryStats(u1,u2,stats);
        rivalryStats.setScore(-Math.abs(rivalryStats.getScore()));
        stats.setBestRivalry(rivalryStats);

        RivalryStats worseRivalryStats = rivalryServiceTest.makeRandomRivalryStats(u1,u3,stats);
        worseRivalryStats.setScore(-Math.abs(rivalryStats.getScore()) - 1);

        statsService.recalculateWorstRivalry(worseRivalryStats);

        assertThat(stats.getWorstRivalry()).isEqualTo(worseRivalryStats);
    }

    @Test
    public void whenBestRivalry_theRivalryBeingNegativeShouldBeRemoved(){

        Stats stats = makeRandomStats(u1,tournament);
        stats.setBestRivalry(null);

        RivalryStats rivalryStats = rivalryServiceTest.makeRandomRivalryStats(u1,u2,stats);
        rivalryStats.setScore(Math.abs(rivalryStats.getScore()));
        stats.setBestRivalry(rivalryStats);

        rivalryStats.setScore(-1);

        statsService.recalculateBestRivalry(rivalryStats);

        assertThat(stats.getBestRivalry()).isEqualTo(null);
    }


    @Test
    public void whenWorstRivalry_theRivalryBeingPositiveShouldBeRemoved(){

        Stats stats = makeRandomStats(u1,tournament);
        stats.setBestRivalry(null);

        RivalryStats rivalryStats = rivalryServiceTest.makeRandomRivalryStats(u1,u2,stats);
        rivalryStats.setScore(-Math.abs(rivalryStats.getScore()));
        stats.setBestRivalry(rivalryStats);

        rivalryStats.setScore(1);

        statsService.recalculateWorstRivalry(rivalryStats);

        assertThat(stats.getWorstRivalry()).isEqualTo(null);
    }

    @Test
    public void whenBestRivalry_theRivalryBeingNegativeShouldBeReplaced(){

        // this test relies on the DB being populated to find the new best rivalry for the stats

        RivalryStats bestRivalry = rivalryServiceTest.makeRandomRivalryStats(u1,u2,s1);
        bestRivalry.setScore(20);
        rivalryStatsRepository.save(bestRivalry);

        s1.setBestRivalry(bestRivalry);
        statsRepository.save(s1);

        RivalryStats secondBestRivalryStats = rivalryServiceTest.makeRandomRivalryStats(u1,u3,s1);
        secondBestRivalryStats.setScore(19);
        rivalryStatsRepository.save(secondBestRivalryStats);

        bestRivalry.setScore(18);
        rivalryStatsRepository.save(bestRivalry);
        statsService.recalculateBestRivalry(bestRivalry);

        assertThat(s1.getBestRivalry().getRivalryStatsId()).isEqualTo(secondBestRivalryStats.getRivalryStatsId());
        assertThat(bestRivalry.getScore()).isLessThan(secondBestRivalryStats.getScore());
    }

    @Test
    public void whenWorstRivalry_theRivalryBeingPositiveShouldBeReplaced(){

        // this test relies on the DB being populated to find the new best rivalry for the stats

        RivalryStats worstRivalry = rivalryServiceTest.makeRandomRivalryStats(u1,u2,s1);
        worstRivalry.setScore(-20);
        rivalryStatsRepository.save(worstRivalry);

        s1.setWorstRivalry(worstRivalry);
        statsRepository.save(s1);

        RivalryStats secondWorstRivalryStats = rivalryServiceTest.makeRandomRivalryStats(u1,u3,s1);
        secondWorstRivalryStats.setScore(-19);
        rivalryStatsRepository.save(secondWorstRivalryStats);

        worstRivalry.setScore(-18);
        rivalryStatsRepository.save(worstRivalry);
        statsService.recalculateWorstRivalry(worstRivalry);

        assertThat(s1.getWorstRivalry().getRivalryStatsId()).isEqualTo(secondWorstRivalryStats.getRivalryStatsId());
        assertThat(worstRivalry.getScore()).isGreaterThan(secondWorstRivalryStats.getScore());
    }

    public StatsDTO makeRandomStatsDTO(UserDTO user, TournamentDTO tournament) {

        StatsDTO stats = new StatsDTO();

        stats.setUser(user);
        stats.setTournament(tournament);

        stats.setScore(new Random().nextDouble());
        stats.setBestScore(Math.max(new Random().nextDouble(), stats.getScore()));
        stats.setWorstScore(Math.min(new Random().nextDouble(), stats.getScore()));

        stats.setLoseCount(Math.abs(new Random().nextInt()));
        stats.setTieCount(Math.abs(new Random().nextInt()));
        stats.setWinCount(Math.abs(new Random().nextInt()));
        stats.setGameCount(stats.getLoseCount() + stats.getWinCount() + stats.getLoseCount());

        stats.setWinStreak(new Random().nextInt(stats.getWinCount()));
        stats.setLoseStreak(new Random().nextInt(stats.getLoseCount()));
        stats.setTieStreak(new Random().nextInt(stats.getTieCount()));

        stats.setLonguestWinStreak(new Random().nextInt(stats.getWinCount()));
        stats.setLonguestLoseStreak(new Random().nextInt(stats.getLoseCount()));
        stats.setLonguestTieStreak(new Random().nextInt(stats.getTieCount()));

        stats.setBestRivalry(null);
        stats.setWorstRivalry(null);

        return stats;
    }

    public Stats makeRandomStats(User user, Tournament tournament) {

        Stats stats = new Stats();

        stats.setUser(user);
        stats.setTournament(tournament);

        stats.setScore(new Random().nextDouble());
        stats.setBestScore(Math.max(new Random().nextDouble(), stats.getScore()));
        stats.setWorstScore(Math.min(new Random().nextDouble(), stats.getScore()));

        stats.setLoseCount(Math.abs(new Random().nextInt()));
        stats.setTieCount(Math.abs(new Random().nextInt()));
        stats.setWinCount(Math.abs(new Random().nextInt()));
        stats.setGameCount(stats.getLoseCount() + stats.getWinCount() + stats.getLoseCount());

        stats.setWinStreak(new Random().nextInt(stats.getWinCount()));
        stats.setLoseStreak(new Random().nextInt(stats.getLoseCount()));
        stats.setTieStreak(new Random().nextInt(stats.getTieCount()));

        stats.setLonguestWinStreak(new Random().nextInt(stats.getWinCount()));
        stats.setLonguestLoseStreak(new Random().nextInt(stats.getLoseCount()));
        stats.setLonguestTieStreak(new Random().nextInt(stats.getTieCount()));

        stats.setBestRivalry(null);
        stats.setWorstRivalry(null);

        return stats;
    }
}
