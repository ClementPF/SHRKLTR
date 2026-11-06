package calc.service;

import calc.DTO.*;
import calc.entity.*;
import calc.repository.*;
import org.junit.Before;
import org.junit.Test;
import org.junit.runner.RunWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.TestExecutionListeners;
import org.springframework.test.context.junit4.SpringRunner;
import org.springframework.test.context.support.DependencyInjectionTestExecutionListener;
import org.springframework.test.context.support.DirtiesContextTestExecutionListener;

import java.text.ParseException;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import java.util.UUID;
import java.util.stream.Collectors;


import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
//@PropertySource(value = {"classpath:application.properties", "${api.config.location}"}, ignoreResourceNotFound = true)
@TestExecutionListeners(inheritListeners = false, listeners = {
        DependencyInjectionTestExecutionListener.class,
        DirtiesContextTestExecutionListener.class
})
@RunWith(SpringRunner.class)
public class OutcomeServiceTest {

    @Autowired
    private OutcomeService outcomeService;
    @Autowired
    private OutcomeRepository outcomeRepository;
    @Autowired
    private GameService gameService;
    @Autowired
    private GameRepository gameRepository;
    @Autowired
    private StatsService statsService;
    @Autowired
    private StatsRepository statsRepository;
    @Autowired
    private RivalryStatsRepository rivalryStatsRepository;
    @Autowired
    private SportRepository sportRepository;
    @Autowired
    private SportService sportService;
    @Autowired
    private UserService userService;
    @Autowired
    private UserRepository userRepository;
    @Autowired
    private TournamentService tournamentService;
    @Autowired
    private TournamentRepository tournamentRepository;

    UserServiceTest userServiceTest;
    TournamentServiceTest tournamentServiceTest;
    GameServiceTest gameServiceTest;
    RivalryServiceTest rivalryServiceTest;
    SportServiceTest sportServiceTest;
    StatsServiceTest statsServiceTest;

    @Before
    public void setUp() {
        userServiceTest = new UserServiceTest();
        tournamentServiceTest = new TournamentServiceTest();
        gameServiceTest = new GameServiceTest();
        statsServiceTest = new StatsServiceTest();
        rivalryServiceTest = new RivalryServiceTest();
        sportServiceTest = new SportServiceTest();
    }

    @Test
    public void test() {

    }

    @Test
    public void findByUserId() {

        User u1 = userRepository.save(userServiceTest.makeRandomUser());
        User u2 = userRepository.save(userServiceTest.makeRandomUser());
        Sport s1 = sportRepository.save(sportServiceTest.makeRandomSport());
        Tournament t1 = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(s1, u1));

        // need to save games directly from repository to avoid the whosLoggedIn
        Game g = gameRepository.save(gameServiceTest.makeRandomGame(u1, u2, t1));
        GameDTO g1 = gameService.convertToDto(g);

        OutcomeDTO outcome = g1.getOutcomes().get(0);
        OutcomeDTO o1 = outcomeService.findByUserId(outcome.getUser().getUserId()).get(0);

        assertThat(o1.getOutcomeId().intValue()).isEqualTo(outcome.getOutcomeId().intValue());
    }

    @Test
    public void findByGameId() {
        User u1 = userRepository.save(userServiceTest.makeRandomUser());
        User u2 = userRepository.save(userServiceTest.makeRandomUser());
        Sport s1 = sportRepository.save(sportServiceTest.makeRandomSport());
        Tournament t1 = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(s1, u1));

        // need to save games directly from repository to avoid the whosLoggedIn
        Game g = gameRepository.save(gameServiceTest.makeRandomGame(u1, u2, t1));
        GameDTO g1 = gameService.convertToDto(g);

        List<OutcomeDTO> o1 = outcomeService.findByGameId(g1.getGameId());

        assertThat(o1).isNotEmpty();
        for(OutcomeDTO o : o1){
            assertThat(o.getGameId()).isEqualTo(g1.getGameId());
        }
    }

    @Test
    public void convertToEntity_GameIdNull() {
        User u1 = userRepository.save(userServiceTest.makeRandomUser());
        Sport s1 = sportRepository.save(sportServiceTest.makeRandomSport());

        OutcomeDTO o = makeRandomOutcomeDTO(userService.convertToDto(u1), Outcome.Result.WIN, new Random().nextDouble());

        Outcome outcome = null;
        try {
            outcome = outcomeService.convertToEntity(o);
        } catch (ParseException e) {
            e.printStackTrace();
        }

        assertThat(o.getResult()).isEqualTo(outcome.getResults());
        assertThat(o.getGameId()).isEqualTo(null);
        assertThat(o.getOutcomeId()).isEqualTo(outcome.getOutcomeId());
        assertThat(o.getUser()).isEqualToComparingFieldByFieldRecursively(userService.convertToDto(u1));
        assertThat(o.getScoreValue()).isEqualTo(outcome.getScoreValue());

    }

    @Test
    public void convertToEntity_GameIdNotNull() {
        User u1 = userRepository.save(userServiceTest.makeRandomUser());
        User u2 = userRepository.save(userServiceTest.makeRandomUser());
        Sport s1 = sportRepository.save(sportServiceTest.makeRandomSport());
        Tournament t1 = tournamentRepository.save(tournamentServiceTest.makeRandomTournament(s1, u1));

        Game game = gameRepository.save(gameServiceTest.makeRandomGame(u1, u2, t1));
        GameDTO gameDTO = gameService.findOne(game.getGameId());

        Outcome outcome_original = game.getOutcomes().get(0);
        Outcome outcome = null;
        try {
            outcome = outcomeService.convertToEntity(gameDTO.getOutcomes().get(0));
        } catch (ParseException e) {
            e.printStackTrace();
        }

        assertThat(outcome.getResults()).isEqualTo(outcome_original.getResults());
        assertThat(outcome.getScoreValue()).isEqualTo(outcome_original.getScoreValue());
        assertThat(outcome.getUser().getUserId()).isEqualTo(outcome_original.getUser().getUserId());
        assertThat(outcome.getGame().getGameId()).isEqualTo(outcome_original.getGame().getGameId());
        assertThat(outcome.getOutcomeId()).isEqualTo(outcome_original.getOutcomeId());
    }

    @Test
    public void convertToDto() {

    }

    public OutcomeDTO makeRandomOutcomeDTO(UserDTO user, Outcome.Result result, double score) {

        return new OutcomeDTO(user, result, score);
    }

    public Outcome makeRandomOutcome(User user, Outcome.Result result, Game game, double score) {

        return new Outcome(score, result, game, user);
    }
}
